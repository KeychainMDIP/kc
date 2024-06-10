import React, { useEffect, useState } from 'react';
import { Box, Button, Grid, MenuItem, Select, Tab, Tabs } from '@mui/material';
import { Table, TableBody, TableRow, TableCell, TextField, Typography } from '@mui/material';
import * as keymaster from './keymaster-lib.js';
import './App.css';

function App() {

    const [tab, setTab] = useState(null);
    const [currentId, setCurrentId] = useState('');
    const [saveId, setSaveId] = useState('');
    const [currentDID, setCurrentDID] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [docsString, setDocsString] = useState(null);
    const [idList, setIdList] = useState(null);
    const [challenge, setChallenge] = useState(null);
    const [response, setResponse] = useState(null);
    const [accessGranted, setAccessGranted] = useState(false);

    const [newName, setNewName] = useState('');
    const [registry, setRegistry] = useState('hyperswarm');
    const [nameList, setNameList] = useState(null);
    const [aliasName, setAliasName] = useState('');
    const [aliasDID, setAliasDID] = useState('');
    const [aliasDocs, setAliasDocs] = useState('');
    const [registries, setRegistries] = useState(null);

    const [groupList, setGroupList] = useState(null);
    const [groupName, setGroupName] = useState('');
    const [selectedGroupName, setSelectedGroupName] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('');
    const [memberDID, setMemberDID] = useState('');
    const [memberDocs, setMemberDocs] = useState('');

    const [schemaList, setSchemaList] = useState(null);
    const [schemaName, setSchemaName] = useState('');
    const [schemaString, setSchemaString] = useState('');
    const [selectedSchemaName, setSelectedSchemaName] = useState('');
    const [editedSchemaName, setEditedSchemaName] = useState('');
    const [selectedSchema, setSelectedSchema] = useState('');

    const [agentList, setAgentList] = useState(null);
    const [credentialTab, setCredentialTab] = useState('');
    const [credentialDID, setCredentialDID] = useState('');
    const [credentialSubject, setCredentialSubject] = useState('');
    const [credentialSchema, setCredentialSchema] = useState('');
    const [credentialString, setCredentialString] = useState('');
    const [credentialRegistry, setCredentialRegistry] = useState(null); // TBD

    const [heldList, setHeldList] = useState(null);
    const [heldDID, setHeldDID] = useState('');
    const [heldString, setHeldString] = useState('');

    useEffect(() => {
        refreshAll();
    }, []);

    async function refreshAll() {
        try {
            const currentId = await keymaster.getCurrentId();
    	    const registries = await keymaster.listRegistries();
            setRegistries(registries);

            if (currentId) {
                setCurrentId(currentId);
                setSelectedId(currentId);

                const idList = await keymaster.listIds();
                setIdList(idList);

                const docs = await keymaster.resolveId(currentId);
                setCurrentDID(docs.didDocument.id);
                setDocsString(JSON.stringify(docs, null, 4));

                refreshNames();
                refreshHeld();

                setTab('identity');
                setCredentialTab('held');
            }
            else {
                setTab('create');
	    }
        } catch (error) {
            window.alert(error);
        }
    }

    async function useId() {
        try {
            await keymaster.setCurrentId(selectedId);
            refreshAll();
        } catch (error) {
            window.alert(error);
        }
    }

    async function showCreate() {
        setSaveId(currentId);
        setCurrentId('');
        setTab('create');
    }

    async function cancelCreate() {
        setCurrentId(saveId);
        setTab('identity');
    }

    async function createId() {
        try {
            await keymaster.createId(newName, registry);
            refreshAll();
        } catch (error) {
            window.alert(error);
        }
    }

    async function resolveId() {
        try {
            const docs = await keymaster.resolveId(selectedId);
            setDocsString(JSON.stringify(docs, null, 4));
        } catch (error) {
            window.alert(error);
        }
    }

    async function removeId() {
        try {
            if (window.confirm(`Are you sure you want to remove ${selectedId}?`)) {
                await keymaster.removeId(selectedId);
                refreshAll();
            }
        } catch (error) {
            window.alert(error);
        }
    }

    async function backupId() {
        try {
            const ok = await keymaster.backupId(selectedId);

            if (ok) {
                window.alert(`${selectedId} backup succeeded`);
            }
            else {
                window.alert(`${selectedId} backup failed`);
            }
        } catch (error) {
            window.alert(error);
        }
    }

    async function recoverId() {
        try {
            const did = window.prompt("Please enter the DID:");
            if (did) {
                const response = await keymaster.recoverId(did);
                refreshAll();
                window.alert(response);
            }
        } catch (error) {
            window.alert(error);
        }
    }

    async function newChallenge() {
        try {
            const challenge = await keymaster.createChallenge();
            setChallenge(challenge);
        } catch (error) {
            window.alert(error);
        }
    }

    async function createResponse() {
        try {
            const response = await keymaster.createResponse(challenge);
            setResponse(response);
        } catch (error) {
            window.alert(error);
        }
    }

    async function verifyResponse() {
        try {
            const verify = await keymaster.verifyResponse(response, challenge);

            if (verify.match) {
                window.alert("Response is VALID");
                setAccessGranted(true);
            }
            else {
                window.alert("Response is NOT VALID");
                setAccessGranted(false);
            }
        } catch (error) {
            window.alert(error);
        }
    }

    async function clearResponse() {
        setResponse('');
        setAccessGranted(false);
    }

    async function refreshNames() {
        const nameList = await keymaster.listNames();
        const names = Object.keys(nameList);

        setNameList(nameList);
        setAliasName('');
        setAliasDID('');
        setAliasDocs('');

        const groupList = [];

        for (const name of names) {
            try {
                const isGroup = await keymaster.groupTest(name);

                if (isGroup) {
                    groupList.push(name);
                }
            }
            catch {
                continue;
            }
        }

        setGroupList(groupList);

        if (!groupList.includes(selectedGroupName)) {
            setSelectedGroupName('');
            setSelectedGroup(null);
        }

        const schemaList = [];

        for (const name of names) {
            try {
                const isSchema = await keymaster.testSchema(name);

                if (isSchema) {
                    schemaList.push(name);
                }
            }
            catch {
                continue;
            }
        }

        setSchemaList(schemaList);

        if (!schemaList.includes(selectedSchemaName)) {
            setSelectedSchemaName('');
            setSelectedSchema(null);
        }

        if (!schemaList.includes(credentialSchema)) {
            setCredentialSchema('');
            setCredentialString('');
        }

        const agentList = await keymaster.listIds();

        for (const name of names) {
            try {
                const isAgent = await keymaster.testAgent(name);

                if (isAgent) {
                    agentList.push(name);
                }
            }
            catch {
                continue;
            }
        }

        setAgentList(agentList);

        if (!agentList.includes(credentialSubject)) {
            setCredentialSubject('');
            setCredentialString('');
        }
    }

    async function addName() {
        try {
            await keymaster.addName(aliasName, aliasDID);
            refreshNames();
        } catch (error) {
            window.alert(error);
        }
    }

    async function removeName(name) {
        try {
            if (window.confirm(`Are you sure you want to remove ${name}?`)) {
                await keymaster.removeName(name);
                refreshNames();
            }
        } catch (error) {
            window.alert(error);
        }
    }

    async function resolveName(name) {
        try {
            const docs = await keymaster.resolveDID(name);
            setAliasDocs(JSON.stringify(docs, null, 4));
        } catch (error) {
            window.alert(error);
        }
    }

    async function createGroup() {
        try {
            if (Object.keys(nameList).includes(groupName)) {
                alert(`${groupName} already in use`);
                return;
            }

            const groupDID = await keymaster.createGroup(groupName);
            await keymaster.addName(groupName, groupDID);

            setGroupName('');
            refreshNames();
            setSelectedGroupName(groupName);
            refreshGroup(groupName);
        } catch (error) {
            window.alert(error);
        }
    }

    async function refreshGroup(groupName) {
        try {
            const group = await keymaster.getGroup(groupName);
            setSelectedGroup(group);
            setMemberDID('');
            setMemberDocs('');
        } catch (error) {
            window.alert(error);
        }
    }

    async function resolveMember(did) {
        try {
            const docs = await keymaster.resolveDID(did);
            setMemberDocs(JSON.stringify(docs, null, 4));
        } catch (error) {
            window.alert(error);
        }
    }

    async function addMember(did) {
        try {
            await keymaster.groupAdd(selectedGroupName, did);
            refreshGroup(selectedGroupName);
        } catch (error) {
            window.alert(error);
        }
    }

    async function removeMember(did) {
        try {
            if (window.confirm(`Remove member from ${selectedGroupName}?`)) {
                await keymaster.groupRemove(selectedGroupName, did);
                refreshGroup(selectedGroupName);
            }
        } catch (error) {
            window.alert(error);
        }
    }

    async function createSchema() {
        try {
            if (Object.keys(nameList).includes(schemaName)) {
                alert(`${schemaName} already in use`);
                return;
            }

            const schemaDID = await keymaster.createSchema();
            await keymaster.addName(schemaName, schemaDID);

            setSchemaName('');
            refreshNames();
            setSelectedSchemaName(schemaName);
            editSchema(schemaName);
        } catch (error) {
            window.alert(error);
        }
    }

    async function editSchema(schemaName) {
        try {
            const schema = await keymaster.getSchema(schemaName);
            setSelectedSchema(schema);
            setEditedSchemaName(schemaName);
            setSchemaString(JSON.stringify(schema, null, 4));
        } catch (error) {
            window.alert(error);
        }
    }

    async function saveSchema() {
        try {
            await keymaster.setSchema(editedSchemaName, JSON.parse(schemaString));
            await editSchema(editedSchemaName);
        } catch (error) {
            window.alert(error);
        }
    }

    async function editCredential() {
        try {
            const credentialBound = await keymaster.bindCredential(credentialSchema, credentialSubject);
            setCredentialString(JSON.stringify(credentialBound, null, 4));
            setCredentialDID('');
        } catch (error) {
            window.alert(error);
        }
    }

    async function issueCredential() {
        try {
            const did = await keymaster.issueCredential(JSON.parse(credentialString));
            setCredentialDID(did);
        } catch (error) {
            window.alert(error);
        }
    }

    async function refreshHeld() {
        try {
            const heldList = await keymaster.listCredentials();
            setHeldList(heldList);
            setHeldString('');
        } catch (error) {
            window.alert(error);
        }
    }

    async function acceptCredential() {
        try {
            const ok = await keymaster.acceptCredential(heldDID);
            if (ok) {
                refreshHeld();
                setHeldDID('');
            }
            else {
                window.alert("Credential not accepted");
            }
        } catch (error) {
            window.alert(error);
        }
    }

    async function removeCredential(did) {
        try {
            if (window.confirm(`Are you sure you want to remove ${did}?`)) {
                await keymaster.removeCredential(did);
                refreshHeld();
            }
        } catch (error) {
            window.alert(error);
        }
    }

    async function resolveCredential(did) {
        try {
            const doc = await keymaster.resolveDID(did);
            setHeldString(JSON.stringify(doc, null, 4));
        } catch (error) {
            window.alert(error);
        }
    }

    async function decryptCredential(did) {
        try {
            const doc = await keymaster.getCredential(did);
            setHeldString(JSON.stringify(doc, null, 4));
        } catch (error) {
            window.alert(error);
        }
    }

    return (
        <div className="App">
            <header className="App-header">

                <h1>Keymaster API Demo</h1>

                <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                    <Grid item>
                        <Typography style={{ fontSize: '1.5em' }}>
                            ID:
                        </Typography>
                    </Grid>
                    <Grid item>
                        <Typography style={{ fontSize: '1.5em', fontWeight: 'bold' }}>
                            {currentId}
                        </Typography>
                    </Grid>
                    <Grid item>
                        <Typography style={{ fontSize: '1em', fontFamily: 'Courier' }}>
                            {currentDID}
                        </Typography>
                    </Grid>
                </Grid>

                <Box>
                    <Tabs
                        value={tab}
                        onChange={(event, newTab) => setTab(newTab)}
                        indicatorColor="primary"
                        textColor="primary"
                        variant="scrollable"
                        scrollButtons="auto"
                    >
                        {currentId &&
                            <Tab key="identity" value="identity" label={'Identities'} />
                        }
                        {currentId &&
                            <Tab key="names" value="names" label={'DIDs'} />
                        }
                        {currentId &&
                            <Tab key="groups" value="groups" label={'Groups'} />
                        }
                        {currentId &&
                            <Tab key="schemas" value="schemas" label={'Schemas'} />
                        }
                        {currentId &&
                            <Tab key="credentials" value="credentials" label={'Credentials'} />
                        }
                        {currentId &&
                            <Tab key="auth" value="auth" label={'Auth'} />
                        }
                        {currentId && accessGranted &&
                            <Tab key="access" value="access" label={'Access'} />
                        }
                        {!currentId &&
                            <Tab key="create" value="create" label={'Create ID'} />
                        }
                    </Tabs>
                </Box>
                <Box style={{ width: '90vw' }}>
                    {tab === 'identity' &&
                        <Box>
                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                <Grid item>
                                    <Select
                                        style={{ width: '300px' }}
                                        value={selectedId}
                                        fullWidth
                                        onChange={(event) => setSelectedId(event.target.value)}
                                    >
                                        {idList.map((idname, index) => (
                                            <MenuItem value={idname} key={index}>
                                                {idname}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={useId}>
                                        Use ID
                                    </Button>
                                </Grid>
                            </Grid>
                            <p />
                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={resolveId}>
                                        Resolve
                                    </Button>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={showCreate}>
                                        Create...
                                    </Button>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={removeId}>
                                        Remove...
                                    </Button>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={backupId}>
                                        Backup
                                    </Button>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={recoverId}>
                                        Recover...
                                    </Button>
                                </Grid>
                            </Grid>
                            <p />
                            <Box>
                                <textarea
                                    value={docsString}
                                    readOnly
                                    style={{ width: '800px', height: '600px', overflow: 'auto' }}
                                />
                            </Box>
                        </Box>
                    }
                    {tab === 'names' &&
                        <Box>
                            <Table style={{ width: '800px' }}>
                                <TableBody>
                                    {Object.entries(nameList).map(([name, did], index) => (
                                        <TableRow key={index}>
                                            <TableCell>{name}</TableCell>
                                            <TableCell>
                                                <Typography style={{ fontSize: '.9em', fontFamily: 'Courier' }}>
                                                    {did}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Button variant="contained" color="primary" onClick={() => resolveName(name)}>
                                                    Resolve
                                                </Button>
                                            </TableCell>
                                            <TableCell>
                                                <Button variant="contained" color="primary" onClick={() => removeName(name)}>
                                                    Remove
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    <TableRow>
                                        <TableCell style={{ width: '100%' }}>
                                            <TextField
                                                label="Name"
                                                style={{ width: '200px' }}
                                                value={aliasName}
                                                onChange={(e) => setAliasName(e.target.value.trim())}
                                                fullWidth
                                                margin="normal"
                                                inputProps={{ maxLength: 20 }}
                                            />
                                        </TableCell>
                                        <TableCell style={{ width: '100%' }}>
                                            <TextField
                                                label="DID"
                                                style={{ width: '500px' }}
                                                value={aliasDID}
                                                onChange={(e) => setAliasDID(e.target.value.trim())}
                                                fullWidth
                                                margin="normal"
                                                inputProps={{ maxLength: 80 }}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Button variant="contained" color="primary" onClick={() => resolveName(aliasDID)} disabled={!aliasDID}>
                                                Resolve
                                            </Button>
                                        </TableCell>
                                        <TableCell>
                                            <Button variant="contained" color="primary" onClick={addName} disabled={!aliasName || !aliasDID}>
                                                Add
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                            <textarea
                                value={aliasDocs}
                                readOnly
                                style={{ width: '800px', height: '600px', overflow: 'auto' }}
                            />
                        </Box>
                    }
                    {tab === 'groups' &&
                        <Box>
                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                <Grid item>
                                    <TextField
                                        label="Group Name"
                                        style={{ width: '300px' }}
                                        value={groupName}
                                        onChange={(e) => setGroupName(e.target.value.trim())}
                                        fullWidth
                                        margin="normal"
                                        inputProps={{ maxLength: 30 }}
                                    />
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={createGroup} disabled={!groupName}>
                                        Create Group
                                    </Button>
                                </Grid>
                            </Grid>
                            {groupList &&
                                <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                    <Grid item>
                                        <Select
                                            style={{ width: '300px' }}
                                            value={selectedGroupName}
                                            fullWidth
                                            displayEmpty
                                            onChange={(event) => setSelectedGroupName(event.target.value)}
                                        >
                                            <MenuItem value="" disabled>
                                                Select group
                                            </MenuItem>
                                            {groupList.map((name, index) => (
                                                <MenuItem value={name} key={index}>
                                                    {name}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </Grid>
                                    <Grid item>
                                        <Button variant="contained" color="primary" onClick={() => refreshGroup(selectedGroupName)} disabled={!selectedGroupName}>
                                            Edit Group
                                        </Button>
                                    </Grid>
                                    <Grid item>
                                        {selectedGroup && `Editing: ${selectedGroup.name}`}
                                    </Grid>
                                </Grid>
                            }
                            {selectedGroup &&
                                <Box>
                                    <Table style={{ width: '800px' }}>
                                        <TableBody>
                                            <TableRow>
                                                <TableCell style={{ width: '100%' }}>
                                                    <TextField
                                                        label="DID"
                                                        style={{ width: '500px' }}
                                                        value={memberDID}
                                                        onChange={(e) => setMemberDID(e.target.value.trim())}
                                                        fullWidth
                                                        margin="normal"
                                                        inputProps={{ maxLength: 80 }}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Button variant="contained" color="primary" onClick={() => resolveMember(memberDID)} disabled={!memberDID}>
                                                        Resolve
                                                    </Button>
                                                </TableCell>
                                                <TableCell>
                                                    <Button variant="contained" color="primary" onClick={() => addMember(memberDID)} disabled={!memberDID}>
                                                        Add
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                            {selectedGroup.members.map((did, index) => (
                                                <TableRow key={index}>
                                                    <TableCell>
                                                        <Typography style={{ fontSize: '.9em', fontFamily: 'Courier' }}>
                                                            {did}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button variant="contained" color="primary" onClick={() => resolveMember(did)}>
                                                            Resolve
                                                        </Button>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button variant="contained" color="primary" onClick={() => removeMember(did)}>
                                                            Remove
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                    <textarea
                                        value={memberDocs}
                                        readOnly
                                        style={{ width: '800px', height: '600px', overflow: 'auto' }}
                                    />
                                </Box>
                            }
                        </Box>
                    }
                    {tab === 'schemas' &&
                        <Box>
                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                <Grid item>
                                    <TextField
                                        label="Schema Name"
                                        style={{ width: '300px' }}
                                        value={schemaName}
                                        onChange={(e) => setSchemaName(e.target.value.trim())}
                                        fullWidth
                                        margin="normal"
                                        inputProps={{ maxLength: 30 }}
                                    />
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={createSchema} disabled={!schemaName}>
                                        Create Schema
                                    </Button>
                                </Grid>
                            </Grid>
                            {schemaList &&
                                <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                    <Grid item>
                                        <Select
                                            style={{ width: '300px' }}
                                            value={selectedSchemaName}
                                            fullWidth
                                            displayEmpty
                                            onChange={(event) => setSelectedSchemaName(event.target.value)}
                                        >
                                            <MenuItem value="" disabled>
                                                Select schema
                                            </MenuItem>
                                            {schemaList.map((name, index) => (
                                                <MenuItem value={name} key={index}>
                                                    {name}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </Grid>
                                    <Grid item>
                                        <Button variant="contained" color="primary" onClick={() => editSchema(selectedSchemaName)} disabled={!selectedSchemaName}>
                                            Edit Schema
                                        </Button>
                                    </Grid>
                                </Grid>
                            }
                            {selectedSchema &&
                                <Box>
                                    <Grid container direction="column" spacing={1}>
                                        <Grid item>
                                            <p>{`Editing: "${editedSchemaName}"`}</p>
                                        </Grid>
                                        <Grid item>
                                            <textarea
                                                value={schemaString}
                                                onChange={(e) => setSchemaString(e.target.value)}
                                                style={{ width: '800px', height: '600px', overflow: 'auto' }}
                                            />
                                        </Grid>
                                        <Grid item>
                                            <Button variant="contained" color="primary" onClick={saveSchema} disabled={!schemaString}>
                                                Save Schema
                                            </Button>
                                        </Grid>
                                    </Grid>
                                </Box>
                            }
                        </Box>
                    }
                    {tab === 'credentials' &&
                        <Box>
                            <Box>
                                <Tabs
                                    value={credentialTab}
                                    onChange={(event, newTab) => setCredentialTab(newTab)}
                                    indicatorColor="primary"
                                    textColor="primary"
                                    variant="scrollable"
                                    scrollButtons="auto"
                                >
                                    <Tab key="held" value="held" label={'Held'} />
                                    <Tab key="issue" value="issue" label={'Issue'} />
                                </Tabs>
                            </Box>
                            {credentialTab === 'held' &&
                                <Box>
                                    <Table style={{ width: '800px' }}>
                                        <TableBody>
                                            {heldList.map((did, index) => (
                                                <TableRow key={index}>
                                                    <TableCell>
                                                        <Typography style={{ fontSize: '.9em', fontFamily: 'Courier' }}>
                                                            {did}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button variant="contained" color="primary" onClick={() => resolveCredential(did)}>
                                                            Resolve
                                                        </Button>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button variant="contained" color="primary" onClick={() => decryptCredential(did)}>
                                                            Decrypt
                                                        </Button>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button variant="contained" color="primary" onClick={() => removeCredential(did)}>
                                                            Remove
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            <TableRow>
                                                <TableCell style={{ width: '100%' }}>
                                                    <TextField
                                                        label="Credential DID"
                                                        style={{ width: '500px' }}
                                                        value={heldDID}
                                                        onChange={(e) => setHeldDID(e.target.value.trim())}
                                                        fullWidth
                                                        margin="normal"
                                                        inputProps={{ maxLength: 80 }}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Button variant="contained" color="primary" onClick={() => resolveCredential(heldDID)} disabled={!heldDID}>
                                                        Resolve
                                                    </Button>
                                                </TableCell>
                                                <TableCell>
                                                    <Button variant="contained" color="primary" onClick={() => decryptCredential(heldDID)} disabled={!heldDID}>
                                                        Decrypt
                                                    </Button>
                                                </TableCell>
                                                <TableCell>
                                                    <Button variant="contained" color="primary" onClick={acceptCredential} disabled={!heldDID}>
                                                        Accept
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        </TableBody>
                                    </Table>
                                    <textarea
                                        value={heldString}
                                        readOnly
                                        style={{ width: '800px', height: '600px', overflow: 'auto' }}
                                    />
                                </Box>
                            }
                            {credentialTab === 'issue' &&
                                <Box>
                                    <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                        <Grid item>
                                            <Select
                                                style={{ width: '300px' }}
                                                value={credentialSubject}
                                                fullWidth
                                                displayEmpty
                                                onChange={(event) => setCredentialSubject(event.target.value)}
                                            >
                                                <MenuItem value="" disabled>
                                                    Select subject
                                                </MenuItem>
                                                {agentList.map((name, index) => (
                                                    <MenuItem value={name} key={index}>
                                                        {name}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </Grid>
                                        <Grid item>
                                            <Select
                                                style={{ width: '300px' }}
                                                value={credentialSchema}
                                                fullWidth
                                                displayEmpty
                                                onChange={(event) => setCredentialSchema(event.target.value)}
                                            >
                                                <MenuItem value="" disabled>
                                                    Select schema
                                                </MenuItem>
                                                {schemaList.map((name, index) => (
                                                    <MenuItem value={name} key={index}>
                                                        {name}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </Grid>
                                        <Grid item>
                                            <Button variant="contained" color="primary" onClick={editCredential} disabled={!credentialSubject || !credentialSchema}>
                                                Edit Credential
                                            </Button>
                                        </Grid>
                                    </Grid>
                                    {credentialString &&
                                        <Box>
                                            <Grid container direction="column" spacing={1}>
                                                <Grid item>
                                                    <p>{`Editing ${credentialSchema} credential for ${credentialSubject}`}</p>
                                                </Grid>
                                                <Grid item>
                                                    <textarea
                                                        value={credentialString}
                                                        onChange={(e) => setCredentialString(e.target.value)}
                                                        style={{ width: '800px', height: '600px', overflow: 'auto' }}
                                                    />
                                                </Grid>
                                                <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                                    <Grid item>
                                                        <Button variant="contained" color="primary" onClick={issueCredential} disabled={!credentialString}>
                                                            Issue Credential
                                                        </Button>
                                                    </Grid>
                                                    {credentialDID &&
                                                        <Grid item>
                                                            <Typography style={{ fontSize: '1em', fontFamily: 'Courier' }}>
                                                                {credentialDID}
                                                            </Typography>
                                                        </Grid>
                                                    }
                                                </Grid>
                                            </Grid>
                                        </Box>
                                    }
                                </Box>
                            }
                        </Box>
                    }
                    {tab === 'create' &&
                        <Grid>
                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                <Grid item>
                                    <TextField
                                        label="Name"
                                        style={{ width: '300px' }}
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value.trim())}
                                        fullWidth
                                        margin="normal"
                                        inputProps={{ maxLength: 30 }}
                                    />
                                </Grid>
                                <Grid item>
                                    <Select
                                        style={{ width: '300px' }}
                                        value={registry}
                                        fullWidth
                                        onChange={(event) => setRegistry(event.target.value)}
                                    >
                                        {registries.map((registry, index) => (
                                            <MenuItem value={registry} key={index}>
                                                {registry}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </Grid>
                            </Grid>
                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={createId} disabled={!newName}>
                                        Create
                                    </Button>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={cancelCreate} disabled={!saveId}>
                                        Cancel
                                    </Button>
                                </Grid>
                            </Grid>
                        </Grid>
                    }
                    {tab === 'auth' &&
                        <Table style={{ width: '800px' }}>
                            <TableBody>
                                <TableRow>
                                    <TableCell style={{ width: '10%' }}>Challenge</TableCell>
                                    <TableCell style={{ width: '80%' }}>
                                        <TextField
                                            label=""
                                            value={challenge}
                                            onChange={(e) => setChallenge(e.target.value.trim())}
                                            fullWidth
                                            margin="normal"
                                            inputProps={{ maxLength: 85, style: { fontFamily: 'Courier', fontSize: '0.8em' } }}
                                        />
                                    </TableCell>
                                    <TableCell style={{ width: '10%' }}>
                                        <Button variant="contained" color="primary" onClick={newChallenge}>
                                            New
                                        </Button>
                                    </TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell style={{ width: '10%' }}>Response</TableCell>
                                    <TableCell style={{ width: '80%' }}>
                                        <TextField
                                            label=""
                                            value={response}
                                            onChange={(e) => setResponse(e.target.value.trim())}
                                            fullWidth
                                            margin="normal"
                                            inputProps={{ maxLength: 85, style: { fontFamily: 'Courier', fontSize: '0.8em' } }}
                                        />
                                    </TableCell>
                                    <TableCell style={{ width: '10%' }}>
                                        {response ? (
                                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                                <Grid item>
                                                    <Button variant="contained" color="primary" onClick={verifyResponse}>
                                                        Verify
                                                    </Button>

                                                </Grid>
                                                <Grid item>
                                                    <Button variant="contained" color="primary" onClick={clearResponse}>
                                                        Clear
                                                    </Button>
                                                </Grid>
                                            </Grid>
                                        ) : (
                                            <Button variant="contained" color="primary" onClick={createResponse} disabled={!challenge}>
                                                Create
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    }
                    {tab === 'access' &&
                        <Box>
                            Special Access
                        </Box>
                    }
                </Box>
            </header>
        </div >
    );
}

export default App;
