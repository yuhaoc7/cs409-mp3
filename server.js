require('dotenv').config({ quiet: true });
const express = require('express');
const mongoose = require('mongoose');
const { HttpError, User, Task } = require('./lib/api');
const app = express();
app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
    res.set('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
require('./routes')(app);
app.use((req, res) => res.status(404).json({ message: 'Endpoint not found', data: null }));
app.use((err, req, res, next) => {
    let status = 500;
    let message = 'Unable to complete the request';
    if (err instanceof HttpError) { status = err.status; message = err.message; }
    else if (err.code === 11000) { status = 400; message = 'Email is already in use'; }
    else if (['CastError', 'ValidationError', 'StrictModeError'].includes(err.name) || err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
        status = 400; message = 'The request contains invalid values';
    }
    res.status(status).json({ message, data: null });
});
async function start() {
    if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in .env before starting the server');
    await mongoose.connect(process.env.MONGODB_URI);
    await Promise.all([User.init(), Task.init()]);
    const port = process.env.PORT || 3000;
    return app.listen(port, () => console.log(`Server running on port ${port}`));
}
if (require.main === module) start().catch(() => { console.error('Unable to start API. Check MONGODB_URI and database access.'); process.exitCode = 1; });
module.exports = { app, start };
