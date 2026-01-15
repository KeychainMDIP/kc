# CID (Java)

Minimal CID validator used by Keymaster for DID checks.

## Usage

```java
import org.keychain.cid.Cid;

boolean ok = Cid.isValid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi");
```

Notes:
- Supports CIDv0 (base58btc) and CIDv1 (base32 lower-case).
- Intended for validation only (no full CID object model yet).
