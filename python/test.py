import keymaster_sdk as keymaster
import json
from datetime import datetime, timedelta

def main():
    try:
        ready = keymaster.isReady()
        print(f"Keymaster is ready: {ready}")

        ids = keymaster.listIds()
        print(f"All IDs: {ids}")

        currentId = keymaster.getCurrendId()
        print(f"Current ID: {currentId}")

        docs = keymaster.resolveId(currentId)
        print(json.dumps(docs, indent=4))

        expires = datetime.now() + timedelta(minutes=1)

        test_options = {
            'registry': 'local',
            'validUntil': expires.isoformat()
        }

        schema = keymaster.createSchema(None, test_options)

        credential = keymaster.bindCredential(schema, currentId)
        print(json.dumps(credential, indent=4))

        for i in range(100):
            vcDID = keymaster.issueCredential(credential, test_options)
            print(f"VC {i}: {vcDID}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
