import keymaster_sdk as keymaster
import json
import argparse
from datetime import datetime, timedelta, timezone

def main():
    # Set up argument parsing
    parser = argparse.ArgumentParser(description="Run Keymaster credential issuance")
    parser.add_argument('-c', '--credentials', type=int, default=100, help="Number of credentials to issue (default is 100)")
    args = parser.parse_args()

    try:
        ready = keymaster.isReady()
        print(f"Keymaster is ready: {ready}")

        currentId = keymaster.getCurrendId()
        print(f"Current ID: {currentId}")

        expires = datetime.now(timezone.utc) + timedelta(minutes=1)

        test_options = {
            'registry': 'local',
            'validUntil': expires.isoformat()
        }

        schema = keymaster.createSchema(None, test_options)

        credential = keymaster.createTemplate(schema)
        print(json.dumps(credential, indent=4))

        test_options['subject'] = currentId
        test_options['schema'] = schema

        for i in range(args.credentials):
            vcDID = keymaster.issueCredential(credential, test_options)
            print(f"VC {i}: {vcDID}")

            vc = keymaster.decryptJSON(vcDID)
            print(json.dumps(vc, indent=4))

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
