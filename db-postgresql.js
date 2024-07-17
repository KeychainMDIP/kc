import { Sequelize, DataTypes } from 'sequelize';
import config from './config.js';
import async from 'async';

const sequelize = new Sequelize('mdip', 'postgres', 'postgres123', {
    host: '34.41.230.147',
    dialect: 'postgres',
    logging: config.debug ? console.log : false,
    pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
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
  
  const eventQueue = async.priorityQueue(async function(task, callback) {
    try {
      await addEvent(task.did, task.event);
      callback();
    } catch (error) {
      console.error('Error processing event:', error);
      callback(error);
    }
  }, 10); // 10 is the concurrency level
  
  export async function start() {
    try {
      await sequelize.authenticate();
      console.log('Database connection has been established successfully.');
      await sequelize.sync(); // This creates the necessary tables if they do not exist
      console.log('Database synchronized successfully.');
    } catch (error) {
      console.error('Unable to connect to the database:', error);
    }
  }
  
  export async function stop() {
    try {
      await sequelize.close();
      console.log('Database connection closed.');
    } catch (error) {
      console.error('Error closing the database connection:', error);
    }
  }
  
  export async function resetDb() {
    try {
      await DID.destroy({ where: {} });
      await Queue.destroy({ where: {} });
      console.log('Database reset successfully.');
    } catch (error) {
      console.error('Error resetting the database:', error);
    }
  }
  
  export async function addEvent(did, event) {
    try {
      if (!did) {
        throw new Error("Invalid DID");
      }
      const id = did.split(':').pop();
      const record = await DID.findByPk(id);
      if (record) {
        record.events.push(event);
        await record.save();
        console.log(`Event added to existing DID: ${id}`);
      } else {
        await DID.create({ id, events: [event] });
        console.log(`New DID created and event added: ${id}`);
      }
    } catch (error) {
      console.error('Error adding event:', error);
    }
  }
  
  export async function getEvents(did) {
    try {
      if (!did) {
        throw new Error("Invalid DID");
      }
      const id = did.split(':').pop();
      const record = await DID.findByPk(id);
      console.log(`Events fetched for DID: ${id}`);
      return record ? record.events : [];
    } catch (error) {
      console.error('Error getting events:', error);
      return [];
    }
  }
  
  export async function deleteEvents(did) {
    try {
      if (!did) {
        throw new Error("Invalid DID");
      }
      const id = did.split(':').pop();
      await DID.destroy({ where: { id } });
      console.log(`Events deleted for DID: ${id}`);
    } catch (error) {
      console.error('Error deleting events:', error);
    }
  }
  
  export async function getAllKeys() {
    try {
      const records = await DID.findAll({ attributes: ['id'] });
      console.log('All keys fetched.');
      return records.map(record => record.id);
    } catch (error) {
      console.error('Error getting all keys:', error);
      return [];
    }
  }
  
  export async function queueOperation(registry, op) {
    try {
      const record = await Queue.findByPk(registry);
      if (record) {
        record.ops.push(op);
        await record.save();
        console.log(`Operation added to existing queue: ${registry}`);
      } else {
        await Queue.create({ id: registry, ops: [op] });
        console.log(`New queue created and operation added: ${registry}`);
      }
    } catch (error) {
      console.error('Error queueing operation:', error);
    }
  }
  
  export async function getQueue(registry) {
    try {
      const record = await Queue.findByPk(registry);
      console.log(`Queue fetched for registry: ${registry}`);
      return record ? record.ops : [];
    } catch (error) {
      console.error('Error getting queue:', error);
      return [];
    }
  }
  
  export async function clearQueue(registry, batch) {
    try {
      const record = await Queue.findByPk(registry);
      if (record) {
        record.ops = record.ops.filter(item => !batch.some(op => op.signature.value === item.signature.value));
        await record.save();
        console.log(`Queue cleared for registry: ${registry}`);
      }
      return true;
    } catch (error) {
      console.error('Error clearing queue:', error);
      return false;
    }
  }
  
  // Add an event to the queue with a priority based on timestamp or version
  export function queueEvent(did, event) {
    eventQueue.push({ did, event }, event.timestamp || event.version || Date.now());
  }