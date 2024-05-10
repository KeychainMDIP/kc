import React, { useEffect, useState } from 'react';
import { Box, Button, Grid, MenuItem, Select, Tab, Tabs } from '@mui/material';
import { Table, TableBody, TableRow, TableCell, TextField, Typography } from '@mui/material';
import axios from 'axios';
//import './App.css';

function App() {

    const [tab, setTab] = useState(null);
    const [currentId, setCurrentId] = useState('');
    const [currentDID, setCurrentDID] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [docs, setDocs] = useState(null);
    const [docsString, setDocsString] = useState(null);
    const [idList, setIdList] = useState(null);
    const [challenge, setChallenge] = useState(null);
    const [response, setResponse] = useState(null);
    const [accessGranted, setAccessGranted] = useState(false);
    const [newName, setNewName] = useState(null);
    const [registry, setRegistry] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                setRegistry('hyperswarm');

                const getCurrentId = await axios.get(`/api/v1/current-id`);
                const currentId = getCurrentId.data;

                if (currentId) {
                    setCurrentId(currentId);
                    setSelectedId(currentId);

                    const getIdList = await axios.get(`/api/v1/ids`);
                    setIdList(getIdList.data);

                    const getDocs = await axios.get(`/api/v1/resolve-id`);
                    const docs = getDocs.data;
                    setDocs(docs);
                    setCurrentDID(docs.didDocument.id);
                    setDocsString(JSON.stringify(docs, null, 4));

                    setTab('ids');
                }
                else {
                    setTab('create');
                }
            } catch (error) {
                alert(error);
            }
        };

        fetchData();
    }, []);

    async function refreshAll() {
        try {
            const getCurrentId = await axios.get(`/api/v1/current-id`);
            setCurrentId(getCurrentId.data);
            setSelectedId(getCurrentId.data);

            const getIdList = await axios.get(`/api/v1/ids`);
            setIdList(getIdList.data);

            const getDocs = await axios.get(`/api/v1/resolve-id`);
            const docs = getDocs.data;
            setDocs(docs);
            setCurrentDID(docs.didDocument.id);
            setDocsString(JSON.stringify(docs, null, 4));
        } catch (error) {
            alert(error);
        }
    }

    async function handleUseId() {
        try {
            await axios.post(`/api/v1/current-id`, { name: selectedId });
            setCurrentId(selectedId);

            const getDocs = await axios.get(`/api/v1/resolve-id`);
            const docs = getDocs.data;
            setDocs(docs);
            setCurrentDID(docs.didDocument.id);
            setDocsString(JSON.stringify(docs, null, 4));
        } catch (error) {
            alert(error);
        }
    }

    async function newChallenge() {
        try {
            const getChallenge = await axios.get(`/api/v1/challenge`);
            setChallenge(getChallenge.data);
        } catch (error) {
            alert(error);
        }
    }

    async function createResponse() {
        try {
            const getResponse = await axios.post(`/api/v1/response`, { challenge: challenge });
            setResponse(getResponse.data);
        } catch (error) {
            alert(error);
        }
    }

    async function verifyResponse() {
        try {
            const getVerify = await axios.post(`/api/v1/verify-response`, { response: response, challenge: challenge });
            const verify = getVerify.data;
            if (verify.match) {
                alert("Response is VALID");
                setAccessGranted(true);
            }
            else {
                alert("Response is NOT VALID");
                setAccessGranted(false);
            }
        } catch (error) {
            alert(error);
        }
    }

    async function clearResponse() {
        setResponse('');
        setAccessGranted(false);
    }

    async function createId() {
        try {
            await axios.post(`/api/v1/ids`, { name: newName, registry: registry });
            refreshAll();
        } catch (error) {
            alert(error);
        }
    }

    const handleCopy = () => {
        navigator.clipboard.writeText(currentDID);
    };

    return (
        <div className="App">
            <header className="App-header">

                <h1>Keymaster Web UI Demo</h1>

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
                        <Tab key="ids" value="ids" label={'Identity'} />
                        <Tab key="docs" value="docs" label={'Documents'} />
                        <Tab key="create" value="create" label={'Create ID'} />
                        <Tab key="challenge" value="challenge" label={'Challenge'} />
                        {accessGranted &&
                            <Tab key="access" value="access" label={'Access'} />
                        }
                    </Tabs>
                </Box>
                <Box style={{ width: '90vw' }}>
                    {tab === 'ids' &&
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
                                <Button variant="contained" color="primary" onClick={handleUseId}>
                                    Use ID
                                </Button>
                            </Grid>
                        </Grid>
                    }
                    {tab === 'docs' &&
                        <Box>
                            <textarea
                                value={docsString}
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
                                            <MenuItem value={'BTC'} key={3}>
                                                BTC
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
                                            label="Challenge"
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
                                            label="Response"
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
