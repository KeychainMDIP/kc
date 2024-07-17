import { json } from '@helia/json';
import { base58btc } from 'multiformats/bases/base58';
import canonicalize from 'canonicalize';
import { createHelia } from 'helia';
import * as cipher from './cipher-lib.js';
import config from './config.js';
import * as db from './db-postgresql.js';  // Assuming PostgreSQL is being used
import async from 'async';
import { Sequelize, DataTypes } from 'sequelize';

const validVersions = [1];
const validTypes = ['agent', 'asset'];
const validRegistries = ['local', 'hyperswarm', 'TESS'];

let helia = null;
let ipfs = null;

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

export async function listRegistries() {
  return validRegistries;
}

export async function start() {
  if (!ipfs) {
    helia = await createHelia();
    ipfs = json(helia);
  }

  await db.start();
}

export async function stop() {
  helia.stop();
  await db.stop();
}

export async function verifyDID(did) {
  await resolveDID(did, null, false, true);
}

export async function verifyDb(chatty = true) {
  const dids = await db.getAllKeys();
  let n = 0;
  let invalid = 0;

  await async.eachLimit(dids, 10, async (did) => {
    n += 1;
    try {
      await verifyDID(did);
      if (chatty) {
        console.log(`${n} ${did} OK`);
      }
    } catch (error) {
      if (chatty) {
        console.log(`${n} ${did} ${error}`);
      }
      invalid += 1;
      await db.deleteEvents(did);
    }
  });

  return invalid;
}

export async function resetDb() {
  await db.resetDb();
}

export async function anchorSeed(seed) {
  const cid = await ipfs.add(JSON.parse(canonicalize(seed)));
  const did = `${config.didPrefix}:${cid.toString(base58btc)}`;
  return did;
}

async function verifyCreateAgent(operation) {
  if (!operation.signature) {
    throw new Error("Invalid operation");
  }

  if (!operation.publicJwk) {
    throw new Error("Invalid operation");
  }

  const operationCopy = JSON.parse(JSON.stringify(operation));
  delete operationCopy.signature;

  const msgHash = cipher.hashJSON(operationCopy);
  const isValid = cipher.verifySig(msgHash, operation.signature.value, operation.publicJwk);

  return isValid;
}

async function verifyCreateAsset(operation) {
  if (operation.controller !== operation.signature.signer) {
    throw new Error("Invalid operation");
  }

  const doc = await resolveDID(operation.signature.signer, operation.signature.signed);

  if (doc.mdip.registry === 'local' && operation.mdip.registry !== 'local') {
    throw new Error("Invalid operation");
  }

  const operationCopy = JSON.parse(JSON.stringify(operation));
  delete operationCopy.signature;
  const msgHash = cipher.hashJSON(operationCopy);
  const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
  const isValid = cipher.verifySig(msgHash, operation.signature.value, publicJwk);

  return isValid;
}

async function verifyCreate(operation) {
  if (operation?.type !== "create") {
    throw new Error("Invalid operation");
  }

  if (!operation.created) {
    throw new Error("Invalid operation");
  }

  if (!operation.mdip) {
    throw new Error("Invalid operation");
  }

  if (!validVersions.includes(operation.mdip.version)) {
    throw new Error(`Valid versions include: ${validVersions}`);
  }

  if (!validTypes.includes(operation.mdip.type)) {
    throw new Error(`Valid types include: ${validTypes}`);
  }

  if (!validRegistries.includes(operation.mdip.registry)) {
    throw new Error(`Valid registries include: ${validRegistries}`);
  }

  if (operation.mdip.type === 'agent') {
    return verifyCreateAgent(operation);
  }

  if (operation.mdip.type === 'asset') {
    return verifyCreateAsset(operation);
  }

  throw new Error("Invalid operation");
}

export async function createDID(operation) {
  const valid = await verifyCreate(operation);

  if (valid) {
    const did = await anchorSeed(operation);
    const ops = await exportDID(did);

    if (ops.length === 0) {
      await db.addEvent(did, {
        registry: 'local',
        time: operation.created,
        ordinal: 0,
        operation: operation
      });

      if (operation.mdip.registry !== 'local') {
        await db.queueOperation('hyperswarm', operation);
      }
    }

    return did;
  } else {
    throw new Error("Invalid operation");
  }
}

async function generateDoc(anchor, asofTime) {
  try {
    if (!anchor?.mdip) {
      return {};
    }

    if (asofTime && new Date(anchor.created) < new Date(asofTime)) {
      return {}; // DID was not yet created
    }

    if (!validVersions.includes(anchor.mdip.version)) {
      return {};
    }

    if (!validTypes.includes(anchor.mdip.type)) {
      return {};
    }

    if (!validRegistries.includes(anchor.mdip.registry)) {
      return {};
    }

    const did = await anchorSeed(anchor);

    if (anchor.mdip.type === 'agent') {
      const doc = {
        "@context": "https://w3id.org/did-resolution/v1",
        "didDocument": {
          "@context": ["https://www.w3.org/ns/did/v1"],
          "id": did,
          "verificationMethod": [
            {
              "id": "#key-1",
              "controller": did,
              "type": "EcdsaSecp256k1VerificationKey2019",
              "publicKeyJwk": anchor.publicJwk,
            }
          ],
          "authentication": [
            "#key-1"
          ],
        },
        "didDocumentMetadata": {
          "created": anchor.created,
        },
        "didDocumentData": {},
        "mdip": anchor.mdip,
      };

      return doc;
    }

    if (anchor.mdip.type === 'asset') {
      const doc = {
        "@context": "https://w3id.org/did-resolution/v1",
        "didDocument": {
          "@context": ["https://www.w3.org/ns/did/v1"],
          "id": did,
          "controller": anchor.controller,
        },
        "didDocumentMetadata": {
          "created": anchor.created,
        },
        "didDocumentData": anchor.data,
        "mdip": anchor.mdip,
      };

      return doc;
    }
  } catch (error) {
    console.error(error);
  }

  return {}; // Unknown type error
}

async function verifyUpdate(operation, doc) {
  if (!doc?.didDocument) {
    return false;
  }

  if (doc.didDocument.controller) {
    const controllerDoc = await resolveDID(doc.didDocument.controller, operation.signature.signed);
    return verifyUpdate(operation, controllerDoc);
  }

  if (!doc.didDocument.verificationMethod) {
    return false;
  }

  const jsonCopy = JSON.parse(JSON.stringify(operation));
  const signature = jsonCopy.signature;
  delete jsonCopy.signature;
  const msgHash = cipher.hashJSON(jsonCopy);

  if (signature.hash && signature.hash !== msgHash) {
    return false;
  }

  const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
  const isValid = cipher.verifySig(msgHash, signature.value, publicJwk);

  return isValid;
}

export async function resolveDID(did, asOfTime = null, confirm = false, verify = false) {
  const events = await db.getEvents(did);

  if (events.length === 0) {
    throw new Error("Invalid DID");
  }

  const anchor = events[0];
  let doc = await generateDoc(anchor.operation);
  let mdip = doc?.mdip;

  if (!mdip) {
    throw new Error("Invalid DID");
  }

  if (asOfTime && new Date(mdip.created) > new Date(asOfTime)) {
    // TBD What to return if DID was created after specified time?
  }

  let version = 1; // initial version is version 1 by definition
  let confirmed = true; // create event is always confirmed by definition

  doc.didDocumentMetadata.version = version;
  doc.didDocumentMetadata.confirmed = confirmed;

  for (const { time, operation, registry } of events) {
    if (operation.type === 'create') {
      continue;
    }

    if (asOfTime && new Date(time) > new Date(asOfTime)) {
      break;
    }

    confirmed = confirmed && mdip.registry === registry;

    if (confirm && !confirmed) {
      break;
    }

    const hash = cipher.hashJSON(doc);

    if (hash !== operation.prev) {
      // hash mismatch
      continue;
    }

    const valid = await verifyUpdate(operation, doc);

    if (!valid) {
      if (verify) {
        throw new Error("Invalid update");
      }

      continue;
    }

    if (operation.type === 'update') {
      version += 1;
      mdip = doc.mdip;
      doc = operation.doc;
      doc.didDocumentMetadata.updated = time;
      doc.didDocumentMetadata.version = version;
      doc.didDocumentMetadata.confirmed = confirmed;
      doc.mdip = mdip;
    } else if (operation.type === 'delete') {
      doc.didDocument = {};
      doc.didDocumentData = {};
      doc.didDocumentMetadata.deactivated = true;
      doc.didDocumentMetadata.deleted = time;
      doc.didDocumentMetadata.confirmed = confirmed;
    } else {
      if (verify) {
        throw new Error("Invalid operation");
      }
      console.error(`unknown type ${operation.type}`);
    }
  }

  return doc;
}

export async function updateDID(operation) {
  try {
    const doc = await resolveDID(operation.did);
    const updateValid = await verifyUpdate(operation, doc);

    if (!updateValid) {
      return false;
    }

    const registry = doc.mdip.registry;

    await db.addEvent(operation.did, {
      registry: 'local',
      time: operation.signature.signed,
      ordinal: 0,
      operation: operation
    });

    if (registry === 'local') {
      return true;
    }

    await db.queueOperation(registry, operation);

    if (registry !== 'hyperswarm') {
      await db.queueOperation('hyperswarm', operation);
    }

    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

export async function deleteDID(operation) {
  return updateDID(operation);
}

export async function getDIDs() {
    const didRecords = await DID.findAll({ attributes: ['id'] });
    const dids = didRecords.map(record => `${config.didPrefix}:${record.id}`);
    return dids;
  }

export async function exportDID(did) {
  return await db.getEvents(did);
}

export async function exportDIDs(dids) {
  const batch = [];

  for (const did of dids) {
    batch.push(await db.getEvents(did));
  }

  return batch;
}

export async function removeDIDs(dids) {
  if (!Array.isArray(dids)) {
    throw new Error("Invalid array");
  }

  for (const did of dids) {
    await db.deleteEvents(did);
  }

  return true;
}

async function importCreateEvent(event) {
  try {
    const valid = await verifyCreate(event.operation);

    if (valid) {
      const did = await anchorSeed(event.operation);
      await db.addEvent(did, event);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function importUpdateEvent(event) {
  try {
    const did = event.operation.did;
    const doc = await resolveDID(did);
    const updateValid = await verifyUpdate(event.operation, doc);

    if (!updateValid) {
      return false;
    }

    await db.addEvent(did, event);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

export async function importEvent(event) {
  if (!event.registry || !event.time || !event.operation) {
    throw new Error("Invalid import");
  }

  let did;

  try {
    if (event.operation.type === 'create') {
      did = await anchorSeed(event.operation);
    } else {
      did = event.operation.did;
    }

    if (!did) {
      throw new Error("Invalid operation");
    }
  } catch {
    throw new Error("Invalid operation");
  }

  const current = await exportDID(did);

  if (current.length === 0) {
    const ok = await importCreateEvent(event);

    if (!ok) {
      throw new Error("Invalid operation");
    }

    return true;
  }

  const create = current[0];
  const registry = create.operation.mdip.registry;
  const match = current.find(item => item.operation.signature.value === event.operation.signature.value);

  if (match) {
    if (match.registry === registry) {
      return false;
    }

    if (event.registry === registry) {
      const index = current.indexOf(match);
      current[index] = event;

      db.setEvents(did, current);
      return true;
    }

    return false;
  }

  const ok = await importUpdateEvent(event);

  if (!ok) {
    throw new Error("Invalid operation");
  }

  return true;
}

export async function importBatch(batch) {
  if (!batch || !Array.isArray(batch) || batch.length < 1) {
    throw new Error("Invalid import");
  }

  let verified = 0;
  let updated = 0;
  let failed = 0;

  await async.eachLimit(batch, 10, async (event) => {
    try {
      const imported = await importEvent(event);

      if (imported) {
        updated += 1;
      } else {
        verified += 1;
      }
    } catch (error) {
      failed += 1;
    }
  });

  return {
    verified: verified,
    updated: updated,
    failed: failed,
  };
}

export async function getQueue(registry) {
  if (!validRegistries.includes(registry)) {
    throw new Error(`Invalid registry`);
  }

  const queue = db.getQueue(registry);
  return queue;
}

export async function clearQueue(registry, events) {
  if (!validRegistries.includes(registry)) {
    throw new Error(`Invalid registry`);
  }

  const ok = db.clearQueue(registry, events);
  return ok;
}
