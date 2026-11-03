const express = require('express');
const api = require('../lib/api');

module.exports = function (app) {
    const router = express.Router();
    router.get('/', (req, res) => res.json({ message: 'Task management API', data: { users: '/api/users', tasks: '/api/tasks' } }));
    for (const [path, Model, write] of [['users', api.User, api.writeUser], ['tasks', api.Task, api.writeTask]]) {
        router.get(`/${path}`, async (req, res) => res.json({ message: 'OK', data: await api.collection(Model, req.query) }));
        router.get(`/${path}/:id`, async (req, res) => {
            await api.findResource(Model, req.params.id);
            const data = await Model.findById(req.params.id).select(api.projection(req.query));
            res.json({ message: 'OK', data });
        });
        for (const method of ['post', 'put']) {
            router[method](`/${path}${method === 'put' ? '/:id' : ''}`, async (req, res) => {
                const data = await api.mongoose.connection.transaction(session => write(req.body, req.params.id, session));
                res.status(method === 'post' ? 201 : 200).json({ message: method === 'post' ? 'Created' : 'Updated', data });
            });
        }
        router.delete(`/${path}/:id`, async (req, res) => {
            await api.mongoose.connection.transaction(async session => {
                const document = await api.findResource(Model, req.params.id, session);
                if (Model === api.User) {
                    await api.Task.updateMany({ assignedUser: document._id.toString() }, { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session });
                } else {
                    await api.User.updateMany({ pendingTasks: document._id.toString() }, { $pull: { pendingTasks: document._id.toString() } }, { session });
                }
                await document.deleteOne({ session });
            });
            res.status(204).end();
        });
    }
    app.use('/api', router);
};
