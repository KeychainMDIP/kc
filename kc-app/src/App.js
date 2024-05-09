import React, { useEffect, useState } from 'react';
import { Button, TextField, FormControl, InputLabel, Select, MenuItem, Grid } from '@mui/material';
import axios from 'axios';
import './App.css';

function App() {

  const [currentId, setCurrentId] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const getCurrentId = await axios.get(`/api/v1/current-id`);
        setCurrentId(getCurrentId.data);
      } catch (error) {
        console.log(error);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        current user: {currentId}
      </header>
    </div>
  );
}

export default App;
