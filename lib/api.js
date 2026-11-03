const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const normalizeId = value => value.toLowerCase();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

async function findResource(Model, id, session) {
    if (!validId(id)) fail(404, `${Model.modelName} not found`);
    const document = await Model.findById(id).session(session || null);
    if (!document) fail(404, `${Model.modelName} not found`);
    return document;
}
function bodyObject(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'A request body is required');
}
function stringField(body, key, required = false, fallback = '') {
    if (!own(body, key) && !required) return fallback;
    if (typeof body[key] !== 'string' || (required && !body[key].trim())) fail(400, `${key} must be a nonempty string`);
    return body[key];
}
function userFields(body) {
    bodyObject(body);
    const name = stringField(body, 'name', true);
    const email = stringField(body, 'email', true);
    const ids = own(body, 'pendingTasks') ? body.pendingTasks : [];
    if (!Array.isArray(ids) || ids.some(id => !validId(id))) fail(400, 'pendingTasks must be a list of valid task IDs');
    return { name, email, pendingTasks: [...new Set(ids.map(normalizeId))] };
}
function taskFields(body) {
    bodyObject(body);
    const name = stringField(body, 'name', true);
    const description = stringField(body, 'description');
    if (!['string', 'number'].includes(typeof body.deadline) || (typeof body.deadline === 'string' && !body.deadline.trim())) fail(400, 'A valid deadline is required');
    const deadline = new Date(body.deadline);
    if (Number.isNaN(deadline.getTime())) fail(400, 'A valid deadline is required');
    const completed = own(body, 'completed') ? body.completed : false;
    if (typeof completed !== 'boolean') fail(400, 'completed must be a boolean');
    let assignedUser = stringField(body, 'assignedUser');
    if (assignedUser && !validId(assignedUser)) fail(400, 'assignedUser must be a valid user ID');
    assignedUser = normalizeId(assignedUser);
    const assignedUserName = stringField(body, 'assignedUserName', false, 'unassigned');
    if (!assignedUser && own(body, 'assignedUserName') && assignedUserName !== 'unassigned') fail(400, 'Unassigned tasks must have assignedUserName unassigned');
    return { name, description, deadline, completed, assignedUser, assignedUserName };
}

async function writeUser(body, id, session) {
    const existing = id === undefined ? null : await findResource(User, id, session);
    const fields = userFields(body);
    if (await User.exists({ email: fields.email, ...(existing ? { _id: { $ne: existing._id } } : {}) }).session(session)) fail(400, 'Email is already in use');
    const tasks = await Task.find({ _id: { $in: fields.pendingTasks } }).session(session);
    if (tasks.some(task => task.completed)) fail(400, 'Completed tasks cannot be pending');
    if (tasks.length !== fields.pendingTasks.length) fail(404, 'A referenced task was not found');
    const user = existing || new User();
    const userId = user._id.toString();
    const removed = user.pendingTasks.filter(taskId => !fields.pendingTasks.includes(taskId));
    // Remove moved tasks from every former owner before assigning them.
    await User.updateMany({ _id: { $ne: user._id }, pendingTasks: { $in: fields.pendingTasks } }, { $pull: { pendingTasks: { $in: fields.pendingTasks } } }, { session });
    await Task.updateMany({ _id: { $in: removed }, assignedUser: userId }, { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session });
    await Task.updateMany({ _id: { $in: fields.pendingTasks } }, { $set: { assignedUser: userId, assignedUserName: fields.name } }, { session });
    await Task.updateMany({ assignedUser: userId }, { $set: { assignedUserName: fields.name } }, { session });
    Object.assign(user, fields);
    await user.save({ session });
    return user;
}
async function writeTask(body, id, session) {
    const existing = id === undefined ? null : await findResource(Task, id, session);
    const fields = taskFields(body);
    if (fields.assignedUser) {
        const user = await findResource(User, fields.assignedUser, session);
        if (own(body, 'assignedUserName') && fields.assignedUserName !== user.name) fail(400, 'assignedUserName must match the assigned user');
        fields.assignedUserName = user.name;
    }
    const task = existing || new Task();
    const taskId = task._id.toString();
    await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } }, { session });
    if (fields.assignedUser && !fields.completed) await User.updateOne({ _id: fields.assignedUser }, { $addToSet: { pendingTasks: taskId } }, { session });
    Object.assign(task, fields);
    await task.save({ session });
    return task;
}
function parse(query, key, fallback) {
    if (query[key] === undefined) return fallback;
    try {
        if (typeof query[key] !== 'string') throw new Error();
        return JSON.parse(query[key]);
    } catch { fail(400, `${key} must contain valid JSON`); }
}
function objectParameter(query, key, fallback = {}) {
    const value = parse(query, key, fallback);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, `${key} must be a JSON object`);
    return value;
}
function projection(query) {
    const value = objectParameter(query, 'select');
    if (Object.values(value).some(item => item !== 0 && item !== 1)) fail(400, 'select values must be 0 or 1');
    const modes = new Set(Object.entries(value).filter(([key]) => key !== '_id').map(([, mode]) => mode));
    if (modes.size > 1) fail(400, 'select cannot mix included and excluded fields');
    return value;
}
async function collection(Model, query) {
    const where = objectParameter(query, 'where');
    const sort = objectParameter(query, 'sort');
    if (Object.values(sort).some(value => value !== 1 && value !== -1)) fail(400, 'sort values must be 1 or -1');
    const select = projection(query);
    const skip = parse(query, 'skip', 0);
    const limit = parse(query, 'limit', Model === Task ? 100 : 0);
    const count = parse(query, 'count', false);
    if (![skip, limit].every(value => Number.isSafeInteger(value) && value >= 0)) fail(400, 'skip and limit must be nonnegative integers');
    if (typeof count !== 'boolean') fail(400, 'count must be a boolean');
    if (count) return Model.countDocuments(where);
    return Model.find(where).sort(sort).select(select).skip(skip).limit(limit);
}
module.exports = { HttpError, findResource, writeUser, writeTask, collection, projection, User, Task, mongoose };
