import React, { useEffect, useState } from 'react';
import { Box, Button, Paper, MenuItem, Select, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Tab, Tabs, Grid } from '@mui/material';
import axios from 'axios';
import './App.css';

function App() {

    const [currentId, setCurrentId] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [tab, setTab] = useState(null);
    const [documents, setDocuments] = useState(null);
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

                setTab('ids');
            } catch (error) {
                console.log(error);
            }
        };

        fetchData();
    }, []);

    return (
        <div className="App">
            <header className="App-header">
                current ID: {currentId}
                <Box>
                    <Tabs
                        value={tab}
                        onChange={(event, newTab) => setTab(newTab)}
                        indicatorColor="primary"
                        textColor="primary"
                        variant="scrollable"
                        scrollButtons="auto"
                    >
                        <Tab key="ids" value="ids" label={'IDs'} />
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
                        </Box>
                    }
                    {tab === 'docs' &&
                        <Box>
                            DID Documents
                            <textarea
                                value={documents}
                                readOnly
                                style={{ width: '600px', height: '400px', overflow: 'auto' }}
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
