import keymaster_sdk as keymaster
import json

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

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
