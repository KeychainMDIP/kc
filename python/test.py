import keymaster_sdk as keymaster
import json

emailSchema = 'did:test:z3v8Auaha4rszsBwMyApaY9eUR1pipjGASYvqqfuXiXhxA8DXmo'

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

        credential = keymaster.bindCredential(emailSchema, currentId)
        print(json.dumps(credential, indent=4))

        for i in range(5):
            vcDID = keymaster.issueCredential(credential)
            print(f"VC {i}: {vcDID}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
