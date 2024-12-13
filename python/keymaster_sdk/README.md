# MDIP Keymaster

Keymaster is a client library for the MDIP.  It manages a wallet with any number of identities.

### Installation

```bash
pip install keymaster-sdk
```

### Requirements

- Running keymaster instance

### Usage

```python
import keymaster_sdk as keymaster

# Optional: URL defaults to http://localhost:4226 and can also
# be set using the environment variable KC_KEYMASTER_URL
keymaster.set_url('http://example.com:4226')

ready = keymaster.is_ready()
print(f'Keymaster is ready: {ready}')
```
