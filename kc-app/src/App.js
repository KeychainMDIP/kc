import React, { useEffect, useState } from 'react';
import { Box, Button, Grid, MenuItem, Select, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import axios from 'axios';
//import './App.css';

function App() {

    const [currentId, setCurrentId] = useState('');
    const [currentDID, setCurrentDID] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [tab, setTab] = useState(null);
    const [docs, setDocs] = useState(null);
    const [docsString, setDocsString] = useState(null);
    const [idList, setIdList] = useState(null);
    const [challenge, setChallenge] = useState(null);
    const [response, setResponse] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
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

                setTab('ids');
            } catch (error) {
                alert(error);
            }
        };

        fetchData();
    }, []);

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
                        <Tab key="challenge" value="challenge" label={'Challenge'} />
                        <Tab key="response" value="response" label={'Response'} />
                    </Tabs>
                </Box>
                <Box style={{ width: '90vw' }}>
                    {tab === 'ids' &&
                        <Box>
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

                            <Button variant="contained" color="primary" onClick={handleUseId}>
                                Use ID
                            </Button>
                        </Box>
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
                    {tab === 'challenge' &&
                        <Box>
                            Challenge
                        </Box>
                    }
                    {tab === 'response' &&
                        <Box>
                            Response
                        </Box>
                    }
                </Box>
            </header>
        </div>
    );
}

export default App;
