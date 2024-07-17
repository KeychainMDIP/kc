import { Sequelize, DataTypes } from 'sequelize';
import config from './config.js';

const sequelize = new Sequelize('mdip', 'postgres', 'postgres', {
    host: 'postgres',
    dialect: 'postgres'
});

const DID = sequelize.define('did', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    events: {
        type: DataTypes.JSON
    }
});

const Queue = sequelize.define('queue', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    ops: {
        type: DataTypes.JSON
    }
});

export async function start() {
    await sequelize.authenticate();
    await sequelize.sync();
}

export async function stop() {
    await sequelize.close();
}

export async function resetDb() {
    await DID.destroy({ where: {} });
}

export async function addEvent(did, event) {
    if (!did) {
        throw "Invalid DID";
    }
    const id = did.split(':').pop();
    const record = await DID.findByPk(id);
    if (record) {
        record.events.push(event);
        await record.save();
    } else {
        await DID.create({ id, events: [event] });
    }
}

export async function getEvents(did) {
    if (!did) {
        throw "Invalid DID";
    }
    const id = did.split(':').pop();
    const record = await DID.findByPk(id);
    return record ? record.events : [];
}

export async function deleteEvents(did) {
    if (!did) {
        throw "Invalid DID";
    }
    const id = did.split(':').pop();
    await DID.destroy({ where: { id } });
}

export async function getAllKeys() {
    const records = await DID.findAll({ attributes: ['id'] });
    return records.map(record => record.id);
}

export async function queueOperation(registry, op) {
    const record = await Queue.findByPk(registry);
    if (record) {
        record.ops.push(op);
        await record.save();
    } else {
        await Queue.create({ id: registry, ops: [op] });
    }
}

export async function getQueue(registry) {
    const record = await Queue.findByPk(registry);
    return record ? record.ops : [];
}

export async function clearQueue(registry, batch) {
    const record = await Queue.findByPk(registry);
    if (record) {
        record.ops = record.ops.filter(item => !batch.some(op => op.signature.value === item.signature.value));
        await record.save();
    }
    return true;
}

