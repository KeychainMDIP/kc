import React, { useEffect, useState } from 'react';
import { Box, Button, Grid, MenuItem, Select, Tab, Tabs } from '@mui/material';
import { Table, TableBody, TableRow, TableCell, TextField, Typography } from '@mui/material';
import * as keymaster from './keymaster-sdk.js';
import './App.css';

function App() {

    const [tab, setTab] = useState(null);
    const [currentId, setCurrentId] = useState('');
    const [currentDID, setCurrentDID] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [docsString, setDocsString] = useState(null);
    const [idList, setIdList] = useState(null);
    const [challenge, setChallenge] = useState(null);
    const [response, setResponse] = useState(null);
    const [accessGranted, setAccessGranted] = useState(false);
    const [newName, setNewName] = useState(null);
    const [registry, setRegistry] = useState('hyperswarm');
    const [nameList, setNameList] = useState(null);
    const [aliasName, setAliasName] = useState(null);
    const [aliasDID, setAliasDID] = useState(null);
    const [aliasDocs, setAliasDocs] = useState(null);

    useEffect(() => {
        refreshAll();
    }, []);

    async function refreshAll() {
        try {
            const currentId = await keymaster.getCurrentId();

            if (currentId) {
                setCurrentId(currentId);
                setSelectedId(currentId);

                const idList = await keymaster.listIds();
                setIdList(idList);

                const docs = await keymaster.resolveId(currentId);
                setCurrentDID(docs.didDocument.id);
                setDocsString(JSON.stringify(docs, null, 4));

                const nameList = await keymaster.listNames();
                setNameList(nameList);

                setTab('ids');
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
        setNameList(nameList);
        setAliasName('');
        setAliasDID('');
        setAliasDocs('');
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

    return (
        <div className="App">
            <header className="App-header">

                <h1>Keymaster Web Wallet</h1>

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
                            <Tab key="ids" value="ids" label={'Identity'} />
                        }
                        {currentId &&
                            <Tab key="names" value="names" label={'Names'} />
                        }
                        <Tab key="create" value="create" label={'Create ID'} />
                        {currentId &&
                            <Tab key="challenge" value="challenge" label={'Challenge'} />
                        }
                        {accessGranted &&
                            <Tab key="access" value="access" label={'Access'} />
                        }
                    </Tabs>
                </Box>
                <Box style={{ width: '90vw' }}>
                    {tab === 'ids' &&
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
                                                onChange={(e) =>
                                                    setAliasName(e.target.value)
                                                }
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
                                                onChange={(e) =>
                                                    setAliasDID(e.target.value)
                                                }
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
                    {tab === 'create' &&
                        <Table style={{ width: '800px' }}>
                            <TableBody>
                                <TableRow>
                                    <TableCell style={{ width: '100%' }}>
                                        <TextField
                                            label="Name"
                                            style={{ width: '300px' }}
                                            value={newName}
                                            onChange={(e) =>
                                                setNewName(e.target.value)
                                            }
                                            fullWidth
                                            margin="normal"
                                            inputProps={{ maxLength: 30 }}
                                        />
                                    </TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell style={{ width: '100%' }}>
                                        <Select
                                            style={{ width: '300px' }}
                                            value={registry}
                                            fullWidth
                                            onChange={(event) => setRegistry(event.target.value)}
                                        >
                                            <MenuItem value={'local'} key={0}>
                                                local
                                            </MenuItem>
                                            <MenuItem value={'hyperswarm'} key={1}>
                                                hyperswarm
                                            </MenuItem>
                                            <MenuItem value={'TESS'} key={2}>
                                                TESS
                                            </MenuItem>
                                        </Select>
                                    </TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell style={{ width: '100%' }}>
                                        <Button variant="contained" color="primary" onClick={createId} disabled={!newName}>
                                            Create
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    }
                    {tab === 'challenge' &&
                        <Table style={{ width: '800px' }}>
                            <TableBody>
                                <TableRow>
                                    <TableCell style={{ width: '10%' }}>Challenge</TableCell>
                                    <TableCell style={{ width: '80%' }}>
                                        <TextField
                                            label=""
                                            value={challenge}
                                            onChange={(e) =>
                                                setChallenge(e.target.value)
                                            }
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
                                            onChange={(e) =>
                                                setResponse(e.target.value)
                                            }
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
        </div>
    );
}

export default App;
