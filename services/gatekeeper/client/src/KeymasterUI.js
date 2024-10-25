import React, { useEffect, useState } from 'react';
import { Box, Button, Grid, MenuItem, Paper, Select, Tab, TableContainer, Tabs } from '@mui/material';
import { Table, TableBody, TableRow, TableCell, TextField, Typography } from '@mui/material';
import axios from 'axios';
import './App.css';

function KeymasterUI({ keymaster, title, challengeDID }) {

    const [tab, setTab] = useState(null);
    const [currentId, setCurrentId] = useState('');
    const [saveId, setSaveId] = useState('');
    const [currentDID, setCurrentDID] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [docsString, setDocsString] = useState(null);
    const [idList, setIdList] = useState(null);
    const [challenge, setChallenge] = useState(null);
    const [callback, setCallback] = useState(null);
    const [widget, setWidget] = useState(false);
    const [response, setResponse] = useState(null);
    const [accessGranted, setAccessGranted] = useState(false);
    const [newName, setNewName] = useState('');
    const [registry, setRegistry] = useState('hyperswarm');
    const [nameList, setNameList] = useState(null);
    const [aliasName, setAliasName] = useState('');
    const [aliasDID, setAliasDID] = useState('');
    const [selectedName, setSelectedName] = useState('');
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
    const [heldList, setHeldList] = useState(null);
    const [heldDID, setHeldDID] = useState('');
    const [heldString, setHeldString] = useState('');
    const [selectedHeld, setSelectedHeld] = useState('');
    const [issuedList, setIssuedList] = useState(null);
    const [selectedIssued, setSelectedIssued] = useState('');
    const [issuedStringOriginal, setIssuedStringOriginal] = useState('');
    const [issuedString, setIssuedString] = useState('');
    const [issuedEdit, setIssuedEdit] = useState(false);
    const [mnemonicString, setMnemonicString] = useState('');
    const [walletString, setWalletString] = useState('');
    const [manifest, setManifest] = useState(null);
    const [checkingWallet, setCheckingWallet] = useState(false);
    const [disableSendResponse, setDisableSendResponse] = useState(true);
    const [authDID, setAuthDID] = useState('');
    const [authString, setAuthString] = useState('');

    useEffect(() => {
        checkForChallenge();
        refreshAll();
        // eslint-disable-next-line
    }, []);

    function showError(error) {
        window.alert(error.error || error);
    }

    async function checkForChallenge() {
        try {
            if (challengeDID) {
                setChallenge(challengeDID);
                setWidget(true);
            }
        } catch (error) {
            showError(error);
        }
    }

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
                setManifest(docs.didDocumentData.manifest);
                setDocsString(JSON.stringify(docs, null, 4));

                refreshNames();
                refreshHeld();
                refreshIssued();

                setTab('identity');
                setCredentialTab('held');
            }
            else {
                setCurrentId('');
                setSelectedId('');
                setCurrentDID('');
                setTab('create');
            }

            setSaveId('');
            setNewName('');
            setMnemonicString('');
            setWalletString('');
            setSelectedName('');
            setSelectedHeld('');
            setSelectedIssued('')
        } catch (error) {
            showError(error);
        }
    }

    async function selectId(id) {
        try {
            setSelectedId(id);
            await keymaster.setCurrentId(id);
            refreshAll();
        } catch (error) {
            showError(error);
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
            await keymaster.createId(newName, { registry });
            refreshAll();
            // TBD this should be done in keymaster?
            // The backup forces a change, triggering registration
            // const ok = await keymaster.backupId(currentId);
        } catch (error) {
            showError(error);
        }
    }

    async function resolveId() {
        try {
            const docs = await keymaster.resolveId(selectedId);
            setManifest(docs.didDocumentData.manifest);
            setDocsString(JSON.stringify(docs, null, 4));
        } catch (error) {
            showError(error);
        }
    }

    async function removeId() {
        try {
            if (window.confirm(`Are you sure you want to remove ${selectedId}?`)) {
                await keymaster.removeId(selectedId);
                refreshAll();
            }
        } catch (error) {
            showError(error);
        }
    }

    async function backupId() {
        try {
            const ok = await keymaster.backupId(selectedId);

            if (ok) {
                showError(`${selectedId} backup succeeded`);
                resolveId();
            }
            else {
                showError(`${selectedId} backup failed`);
            }
        } catch (error) {
            showError(error);
        }
    }

    async function recoverId() {
        try {
            const did = window.prompt("Please enter the DID:");
            if (did) {
                const response = await keymaster.recoverId(did);
                refreshAll();
                showError(response);
            }
        } catch (error) {
            showError(error);
        }
    }

    async function newChallenge() {
        try {
            const challenge = await keymaster.createChallenge();
            setChallenge(challenge);
            resolveChallenge(challenge);
        } catch (error) {
            showError(error);
        }
    }

    async function resolveChallenge(did) {
        try {
            const asset = await keymaster.resolveAsset(did);
            setAuthDID(did);
            setAuthString(JSON.stringify(asset, null, 4));
        } catch (error) {
            showError(error);
        }
    }

    async function createResponse() {
        try {
            await clearResponse();
            const response = await keymaster.createResponse(challenge, { retries: 10 });
            setResponse(response);

            const asset = await keymaster.resolveAsset(challenge);
            const callback = asset.challenge.callback;

            setCallback(callback);

            if (callback) {
                setDisableSendResponse(false);
            }
            decryptResponse(response);
        } catch (error) {
            showError(error);
        }
    }

    async function clearChallenge() {
        setChallenge('');
    }

    async function decryptResponse(did) {
        try {
            const decrypted = await keymaster.decryptJSON(did);
            setAuthDID(did);
            setAuthString(JSON.stringify(decrypted, null, 4));
        } catch (error) {
            showError(error);
        }
    }

    async function verifyResponse() {
        try {
            const verify = await keymaster.verifyResponse(response);

            if (verify.match) {
                showError("Response is VALID");
                setAccessGranted(true);
            }
            else {
                showError("Response is NOT VALID");
                setAccessGranted(false);
            }
        } catch (error) {
            showError(error);
        }
    }

    async function clearResponse() {
        setResponse('');
        setAccessGranted(false);
    }

    async function sendResponse() {
        try {
            setDisableSendResponse(true);
            axios.post(callback, { response });
        } catch (error) {
            showError(error);
        }
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
                const isGroup = await keymaster.testGroup(name);

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
            showError(error);
        }
    }

    async function removeName(name) {
        try {
            if (window.confirm(`Are you sure you want to remove ${name}?`)) {
                await keymaster.removeName(name);
                refreshNames();
            }
        } catch (error) {
            showError(error);
        }
    }

    async function resolveName(name) {
        try {
            const docs = await keymaster.resolveDID(name);
            setSelectedName(name);
            setAliasDocs(JSON.stringify(docs, null, 4));
        } catch (error) {
            showError(error);
        }
    }

    async function createGroup() {
        try {
            if (Object.keys(nameList).includes(groupName)) {
                alert(`${groupName} already in use`);
                return;
            }

            const name = groupName;
            setGroupName('');

            const groupDID = await keymaster.createGroup(name, { registry });
            await keymaster.addName(groupName, groupDID);

            refreshNames();
            setSelectedGroupName(name);
            refreshGroup(name);
        } catch (error) {
            showError(error);
        }
    }

    async function refreshGroup(groupName) {
        try {
            const group = await keymaster.getGroup(groupName);
            setSelectedGroup(group);
            setMemberDID('');
            setMemberDocs('');
        } catch (error) {
            showError(error);
        }
    }

    async function resolveMember(did) {
        try {
            const docs = await keymaster.resolveDID(did);
            setMemberDocs(JSON.stringify(docs, null, 4));
        } catch (error) {
            showError(error);
        }
    }

    async function addMember(did) {
        try {
            await keymaster.addGroupMember(selectedGroupName, did);
            refreshGroup(selectedGroupName);
        } catch (error) {
            showError(error);
        }
    }

    async function removeMember(did) {
        try {
            if (window.confirm(`Remove member from ${selectedGroupName}?`)) {
                await keymaster.removeGroupMember(selectedGroupName, did);
                refreshGroup(selectedGroupName);
            }
        } catch (error) {
            showError(error);
        }
    }

    async function createSchema() {
        try {
            if (Object.keys(nameList).includes(schemaName)) {
                alert(`${schemaName} already in use`);
                return;
            }

            const name = schemaName;
            setSchemaName('');

            const schemaDID = await keymaster.createSchema(null, { registry });
            await keymaster.addName(name, schemaDID);

            refreshNames();
            setSelectedSchemaName(name);
            editSchema(name);
        } catch (error) {
            showError(error);
        }
    }

    async function editSchema(schemaName) {
        try {
            const schema = await keymaster.getSchema(schemaName);
            setSelectedSchema(schema);
            setEditedSchemaName(schemaName);
            setSchemaString(JSON.stringify(schema, null, 4));
        } catch (error) {
            showError(error);
        }
    }

    async function saveSchema() {
        try {
            await keymaster.setSchema(editedSchemaName, JSON.parse(schemaString));
            await editSchema(editedSchemaName);
        } catch (error) {
            showError(error);
        }
    }

    async function editCredential() {
        try {
            const credentialBound = await keymaster.bindCredential(credentialSchema, credentialSubject);
            setCredentialString(JSON.stringify(credentialBound, null, 4));
            setCredentialDID('');
        } catch (error) {
            showError(error);
        }
    }

    async function issueCredential() {
        try {
            const did = await keymaster.issueCredential(JSON.parse(credentialString), { registry });
            setCredentialDID(did);
            // Add did to issuedList
            setIssuedList(prevIssuedList => [...prevIssuedList, did]);
        } catch (error) {
            showError(error);
        }
    }

    async function refreshHeld() {
        try {
            const heldList = await keymaster.listCredentials();
            setHeldList(heldList);
            setHeldString('');
        } catch (error) {
            showError(error);
        }
    }

    async function refreshIssued() {
        try {
            const issuedList = await keymaster.listIssued();
            setIssuedList(issuedList);
            setIssuedString('');
        } catch (error) {
            showError(error);
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
                showError("Credential not accepted");
            }
        } catch (error) {
            showError(error);
        }
    }

    async function removeCredential(did) {
        try {
            if (window.confirm(`Are you sure you want to remove ${did}?`)) {
                await keymaster.removeCredential(did);
                refreshHeld();
            }
        } catch (error) {
            showError(error);
        }
    }

    async function resolveCredential(did) {
        try {
            const doc = await keymaster.resolveDID(did);
            setSelectedHeld(did);
            setHeldString(JSON.stringify(doc, null, 4));
        } catch (error) {
            showError(error);
        }
    }

    async function decryptCredential(did) {
        try {
            const doc = await keymaster.getCredential(did);
            setSelectedHeld(did);
            setHeldString(JSON.stringify(doc, null, 4));
        } catch (error) {
            showError(error);
        }
    }

    async function publishCredential(did) {
        try {
            await keymaster.publishCredential(did, { reveal: false });
            resolveId();
            decryptCredential(did);
        } catch (error) {
            showError(error);
        }
    }

    async function revealCredential(did) {
        try {
            await keymaster.publishCredential(did, { reveal: true });
            resolveId();
            decryptCredential(did);
        } catch (error) {
            showError(error);
        }
    }

    async function unpublishCredential(did) {
        try {
            await keymaster.unpublishCredential(did);
            resolveId();
            decryptCredential(did);
        } catch (error) {
            showError(error);
        }
    }

    function credentialPublished(did) {
        if (!manifest) {
            return false;
        }

        if (!manifest[did]) {
            return false;
        }

        return manifest[did].credential === null;
    }

    function credentialRevealed(did) {
        if (!manifest) {
            return false;
        }

        if (!manifest[did]) {
            return false;
        }

        return manifest[did].credential !== null;
    }

    function credentialUnpublished(did) {
        if (!manifest) {
            return true;
        }

        return !manifest[did];
    }

    async function resolveIssued(did) {
        try {
            const doc = await keymaster.resolveDID(did);
            setSelectedIssued(did);
            setIssuedString(JSON.stringify(doc, null, 4));
        } catch (error) {
            showError(error);
        }
    }

    async function decryptIssued(did) {
        try {
            const doc = await keymaster.getCredential(did);
            setSelectedIssued(did);
            const issued = JSON.stringify(doc, null, 4);
            setIssuedStringOriginal(issued);
            setIssuedString(issued);
            setIssuedEdit(true);
        } catch (error) {
            showError(error);
        }
    }

    async function updateIssued(did) {
        try {
            const credential = JSON.parse(issuedString);
            await keymaster.updateCredential(did, credential);
            decryptIssued(did);
        } catch (error) {
            showError(error);
        }
    }

    async function revokeIssued(did) {
        try {
            if (window.confirm(`Revoke credential?`)) {
                await keymaster.revokeCredential(did);

                // Remove did from issuedList
                const newIssuedList = issuedList.filter(item => item !== did);
                setIssuedList(newIssuedList);
            }
        } catch (error) {
            showError(error);
        }
    }

    async function showMnemonic() {
        try {
            const response = await keymaster.decryptMnemonic();
            setMnemonicString(response);
        } catch (error) {
            showError(error);
        }
    }

    async function hideMnemonic() {
        setMnemonicString('');
    }

    async function newWallet() {
        try {
            if (window.confirm(`Overwrite wallet with new one?`)) {
                await keymaster.newWallet(null, true);
                refreshAll();
            }
        } catch (error) {
            showError(error);
        }
    }

    async function importWallet() {
        try {
            const mnenomic = window.prompt("Overwrite wallet with mnemonic:");

            if (mnenomic) {
                await keymaster.newWallet(mnenomic, true);
                await keymaster.recoverWallet();
                refreshAll();
            }
        } catch (error) {
            showError(error);
        }
    }

    async function backupWallet() {
        try {
            await keymaster.backupWallet();
            showError('Wallet backup successful')

        } catch (error) {
            showError(error);
        }
    }

    async function recoverWallet() {
        try {
            if (window.confirm(`Overwrite wallet from backup?`)) {
                await keymaster.recoverWallet();
                refreshAll();
            }
        } catch (error) {
            showError(error);
        }
    }

    async function checkWallet() {
        setCheckingWallet(true);
        try {
            const { checked, invalid, deleted } = await keymaster.checkWallet();

            if (invalid === 0 && deleted === 0) {
                showError(`${checked} DIDs checked, no problems found`);
            }
            else if (window.confirm(`${checked} DIDs checked\n${invalid} invalid DIDs found\n${deleted} deleted DIDs found\n\nFix wallet?`)) {
                const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();
                showError(`${idsRemoved} IDs removed\n${ownedRemoved} owned DIDs removed\n${heldRemoved} held DIDs removed\n${namesRemoved} names removed`);
                refreshAll();
            }

        } catch (error) {
            showError(error);
        }
        setCheckingWallet(false);
    }

    async function showWallet() {
        try {
            const wallet = await keymaster.loadWallet();
            setWalletString(JSON.stringify(wallet, null, 4));
        } catch (error) {
            showError(error);
        }
    }

    async function hideWallet() {
        setWalletString('');
    }

    async function uploadWallet() {
        try {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'application/json';

            fileInput.onchange = async (event) => {
                const file = event.target.files[0];
                const reader = new FileReader();

                reader.onload = async (event) => {
                    const walletUpload = event.target.result;
                    const wallet = JSON.parse(walletUpload);

                    if (window.confirm('Overwrite wallet with upload?')) {
                        await keymaster.saveWallet(wallet);
                        refreshAll();
                    }
                };

                reader.onerror = (error) => {
                    showError(error);
                };

                reader.readAsText(file);
            };

            fileInput.click();
        }
        catch (error) {
            showError(error);
        }
    }

    async function downloadWallet() {
        try {
            const wallet = await keymaster.loadWallet();
            const walletJSON = JSON.stringify(wallet, null, 4);
            const blob = new Blob([walletJSON], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = 'mdip-wallet.json';
            link.click();

            // The URL.revokeObjectURL() method releases an existing object URL which was previously created by calling URL.createObjectURL().
            URL.revokeObjectURL(url);
        } catch (error) {
            showError(error);
        }
    }

    return (
        <div className="App">
            <header className="App-header">

                <h1>{title}</h1>

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
                        {currentId && !widget &&
                            <Tab key="names" value="names" label={'DIDs'} />
                        }
                        {currentId && !widget &&
                            <Tab key="groups" value="groups" label={'Groups'} />
                        }
                        {currentId && !widget &&
                            <Tab key="schemas" value="schemas" label={'Schemas'} />
                        }
                        {currentId && !widget &&
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
                        <Tab key="wallet" value="wallet" label={'Wallet'} />
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
                                        onChange={(event) => selectId(event.target.value)}
                                    >
                                        {idList.map((idname, index) => (
                                            <MenuItem value={idname} key={index}>
                                                {idname}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </Grid>
                            </Grid>
                            <p />
                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
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
                            {!widget &&
                                <Box>
                                    <textarea
                                        value={docsString}
                                        readOnly
                                        style={{ width: '800px', height: '600px', overflow: 'auto' }}
                                    />
                                </Box>
                            }
                        </Box>
                    }
                    {tab === 'names' &&
                        <Box>
                            <TableContainer component={Paper} style={{ maxHeight: '300px', overflow: 'auto' }}>
                                <Table style={{ width: '800px' }}>
                                    <TableBody>
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
                                    </TableBody>
                                </Table>
                            </TableContainer>
                            <p>{selectedName}</p>
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
                                    <Tab key="issued" value="issued" label={'Issued'} />
                                </Tabs>
                            </Box>
                            {credentialTab === 'held' &&
                                <Box>
                                    <TableContainer component={Paper} style={{ maxHeight: '300px', overflow: 'auto' }}>
                                        <Table style={{ width: '800px' }}>
                                            <TableBody>
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
                                                {heldList.map((did, index) => (
                                                    <TableRow key={index}>
                                                        <TableCell colSpan={6}>
                                                            <Typography style={{ fontSize: '1em', fontFamily: 'Courier' }}>
                                                                {did}
                                                            </Typography>
                                                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                                                <Grid item>
                                                                    <Button variant="contained" color="primary" onClick={() => resolveCredential(did)}>
                                                                        Resolve
                                                                    </Button>
                                                                </Grid>
                                                                <Grid item>
                                                                    <Button variant="contained" color="primary" onClick={() => decryptCredential(did)}>
                                                                        Decrypt
                                                                    </Button>
                                                                </Grid>
                                                                <Grid item>
                                                                    <Button variant="contained" color="primary" onClick={() => removeCredential(did)} disabled={!credentialUnpublished(did)}>
                                                                        Remove
                                                                    </Button>
                                                                </Grid>
                                                                <Grid item>
                                                                    <Button variant="contained" color="primary" onClick={() => publishCredential(did)} disabled={credentialPublished(did)}>
                                                                        Publish
                                                                    </Button>
                                                                </Grid>
                                                                <Grid item>
                                                                    <Button variant="contained" color="primary" onClick={() => revealCredential(did)} disabled={credentialRevealed(did)}>
                                                                        Reveal
                                                                    </Button>
                                                                </Grid>
                                                                <Grid item>
                                                                    <Button variant="contained" color="primary" onClick={() => unpublishCredential(did)} disabled={credentialUnpublished(did)}>
                                                                        Unpublish
                                                                    </Button>
                                                                </Grid>
                                                            </Grid>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                    <p>{selectedHeld}</p>
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
                                                {credentialDID &&
                                                    <Grid item>
                                                        <Typography style={{ fontSize: '1em', fontFamily: 'Courier' }}>
                                                            {credentialDID}
                                                        </Typography>
                                                    </Grid>
                                                }
                                            </Grid>
                                        </Box>
                                    }
                                </Box>
                            }
                            {credentialTab === 'issued' &&
                                <Box>
                                    <TableContainer component={Paper} style={{ maxHeight: '300px', overflow: 'auto' }}>
                                        <Table style={{ width: '800px' }}>
                                            <TableBody>
                                                {issuedList.map((did, index) => (
                                                    <TableRow key={index}>
                                                        <TableCell colSpan={6}>
                                                            <Typography style={{ fontSize: '1em', fontFamily: 'Courier' }}>
                                                                {did}
                                                            </Typography>
                                                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                                                <Grid item>
                                                                    <Button variant="contained" color="primary" onClick={() => resolveIssued(did)}>
                                                                        Resolve
                                                                    </Button>
                                                                </Grid>
                                                                <Grid item>
                                                                    <Button variant="contained" color="primary" onClick={() => decryptIssued(did)}>
                                                                        Decrypt
                                                                    </Button>
                                                                </Grid>
                                                                <Grid item>
                                                                    <Button variant="contained" color="primary" onClick={() => updateIssued(did)} disabled={did !== selectedIssued || !issuedEdit || issuedString === issuedStringOriginal}>
                                                                        Update
                                                                    </Button>
                                                                </Grid>
                                                                <Grid item>
                                                                    <Button variant="contained" color="primary" onClick={() => revokeIssued(did)}>
                                                                        Revoke
                                                                    </Button>
                                                                </Grid>
                                                            </Grid>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                    <p>{selectedIssued}</p>
                                    {issuedEdit ? (
                                        <textarea
                                            value={issuedString}
                                            onChange={(e) => setIssuedString(e.target.value.trim())}
                                            style={{ width: '800px', height: '600px', overflow: 'auto' }}
                                        />

                                    ) : (
                                        <textarea
                                            value={issuedString}
                                            readOnly
                                            style={{ width: '800px', height: '600px', overflow: 'auto' }}
                                        />
                                    )}
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
                        <Box>
                            <Table style={{ width: '800px' }}>
                                <TableBody>
                                    <TableRow>
                                        <TableCell style={{ width: '20%' }}>Challenge</TableCell>
                                        <TableCell style={{ width: '80%' }}>
                                            <TextField
                                                label=""
                                                value={challenge}
                                                onChange={(e) => setChallenge(e.target.value.trim())}
                                                fullWidth
                                                margin="normal"
                                                inputProps={{ maxLength: 85, style: { fontFamily: 'Courier', fontSize: '0.8em' } }}
                                            />
                                            <br />
                                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                                <Grid item>
                                                    <Button variant="contained" color="primary" onClick={newChallenge}>
                                                        New
                                                    </Button>
                                                </Grid>
                                                <Grid item>
                                                    <Button variant="contained" color="primary" onClick={() => resolveChallenge(challenge)} disabled={!challenge || challenge === authDID}>
                                                        Resolve
                                                    </Button>
                                                </Grid>
                                                <Grid item>
                                                    <Button variant="contained" color="primary" onClick={createResponse} disabled={!challenge}>
                                                        Respond
                                                    </Button>
                                                </Grid>
                                                <Grid item>
                                                    <Button variant="contained" color="primary" onClick={clearChallenge} disabled={!challenge}>
                                                        Clear
                                                    </Button>
                                                </Grid>
                                            </Grid>
                                        </TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell style={{ width: '20%' }}>Response</TableCell>
                                        <TableCell style={{ width: '80%' }}>
                                            <TextField
                                                label=""
                                                value={response}
                                                onChange={(e) => setResponse(e.target.value.trim())}
                                                fullWidth
                                                margin="normal"
                                                inputProps={{ maxLength: 85, style: { fontFamily: 'Courier', fontSize: '0.8em' } }}
                                            />
                                            <br />
                                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                                <Grid item>
                                                    <Button variant="contained" color="primary" onClick={() => decryptResponse(response)} disabled={!response || response === authDID}>
                                                        Decrypt
                                                    </Button>
                                                </Grid>
                                                <Grid item>
                                                    <Button variant="contained" color="primary" onClick={verifyResponse} disabled={!response}>
                                                        Verify
                                                    </Button>
                                                </Grid>
                                                <Grid item>
                                                    <Button variant="contained" color="primary" onClick={sendResponse} disabled={disableSendResponse}>
                                                        Send
                                                    </Button>
                                                </Grid>
                                                <Grid item>
                                                    <Button variant="contained" color="primary" onClick={clearResponse} disabled={!response}>
                                                        Clear
                                                    </Button>
                                                </Grid>
                                            </Grid>
                                        </TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                            <p>{authDID}</p>
                            <textarea
                                value={authString}
                                readOnly
                                style={{ width: '800px', height: '600px', overflow: 'auto' }}
                            />
                        </Box>
                    }
                    {tab === 'wallet' &&
                        <Box>
                            <p />
                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={newWallet}>
                                        New...
                                    </Button>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={importWallet}>
                                        Import...
                                    </Button>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={backupWallet}>
                                        Backup
                                    </Button>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={recoverWallet}>
                                        Recover...
                                    </Button>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={checkWallet} disabled={checkingWallet}>
                                        Check...
                                    </Button>
                                </Grid>
                            </Grid>
                            <p />
                            <Grid container direction="row" justifyContent="flex-start" alignItems="center" spacing={3}>
                                <Grid item>
                                    {mnemonicString ? (
                                        <Button variant="contained" color="primary" onClick={hideMnemonic}>
                                            Hide Mnemonic
                                        </Button>
                                    ) : (
                                        <Button variant="contained" color="primary" onClick={showMnemonic}>
                                            Show Mnemonic
                                        </Button>
                                    )}
                                </Grid>
                                <Grid item>
                                    {walletString ? (
                                        <Button variant="contained" color="primary" onClick={hideWallet}>
                                            Hide Wallet
                                        </Button>
                                    ) : (
                                        <Button variant="contained" color="primary" onClick={showWallet}>
                                            Show Wallet
                                        </Button>
                                    )}
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={downloadWallet}>
                                        Download
                                    </Button>
                                </Grid>
                                <Grid item>
                                    <Button variant="contained" color="primary" onClick={uploadWallet}>
                                        Upload...
                                    </Button>
                                </Grid>
                            </Grid>
                            <p />
                            <Box>
                                <pre>{mnemonicString}</pre>
                            </Box>
                            <Box>
                                {walletString &&
                                    <textarea
                                        value={walletString}
                                        readonly
                                        style={{ width: '800px', height: '600px', overflow: 'auto' }}
                                    />
                                }
                            </Box>
                        </Box>
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

export default KeymasterUI;
