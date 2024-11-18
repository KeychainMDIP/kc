import requests
from config import KEYMASTER_URL

KEYMASTER_API = KEYMASTER_URL + "/api/v1"

class KeymasterError(Exception):
    """An error occurred while communicating with the Keymaster API."""

def proxy_request(method, url, **kwargs):
    """
    Send a request to the specified URL and handle any HTTP errors.

    Args:
        method (str): The HTTP method to use for the request.
        url (str): The URL to send the request to.
        **kwargs: Additional arguments to pass to `requests.request`.

    Returns:
        dict: The JSON response from the server.

    Raises:
        HTTPException: If the request fails, with the status code and response text from the server.
    """
    try:
        response = requests.request(method, url, **kwargs)
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as e:
        raise KeymasterError(f"Error {e.response.status_code}: {e.response.text}")

def isReady():
    response = proxy_request('GET', f'{KEYMASTER_API}/ready')
    return response['ready']

def getCurrendId():
    response = proxy_request('GET', f'{KEYMASTER_API}/ids/current')
    return response['current']

def listIds():
    response = proxy_request('GET', f'{KEYMASTER_API}/ids')
    return response['ids']

def resolveId(id):
    response = proxy_request('GET', f'{KEYMASTER_API}/ids/{id}')
    return response['docs']

def createSchema(schema, options={}):
    response = proxy_request('POST', f'{KEYMASTER_API}/schemas', json={"schema": schema, "options": options})
    return response['did']

def bindCredential(schema, subject, options={}):
    response = proxy_request('POST', f'{KEYMASTER_API}/credentials/bind', json={"schema": schema, "subject": subject, "options": options})
    return response['credential']

def issueCredential(credential, options={}):
    response = proxy_request('POST', f'{KEYMASTER_API}/credentials/issued', json={"credential": credential, "options": options})
    return response['did']
