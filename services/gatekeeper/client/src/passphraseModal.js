import React, { useState } from 'react';
import './passphraseModal.css';

const PassphraseModal = ({ isOpen, title, errorText, onSubmit, onClose }) => {
    const [passphrase, setPassphrase] = useState('');

    if (!isOpen) return null;

    function handleSubmit(e) {
        e.preventDefault();
        onSubmit(passphrase);
        setPassphrase('');
    }

    function handleClose(){
        onClose();
        setPassphrase('');
    }

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>{title}</h2>
                {errorText &&
                    <h3>{errorText}</h3>
                }
                <form onSubmit={handleSubmit}>
                    <input
                        type="password"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        placeholder="Enter your passphrase"
                        required
                        autoFocus
                    />
                    <div className="modal-actions">
                        <button type="submit">Submit</button>
                        <button type="button" onClick={handleClose}>Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PassphraseModal;
