import requests

_base_url = "http://localhost:4226"
_keymaster_api = _base_url + "/api/v1"


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
        HTTPException: If the request fails, with the status
        code and response text from the server.
    """
    try:
        response = requests.request(method, url, **kwargs)
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as e:
        raise KeymasterError(f"Error {e.response.status_code}: {e.response.text}")


def set_url(new_url: str):
    global _base_url, _keymaster_api
    _base_url = new_url
    _keymaster_api = _base_url + "/api/v1"


def is_ready():
    response = proxy_request("GET", f"{_keymaster_api}/ready")
    return response["ready"]


def create_id(name, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST", f"{_keymaster_api}/ids", json={"name": name, "options": options}
    )
    return response["did"]


def get_current_id():
    response = proxy_request("GET", f"{_keymaster_api}/ids/current")
    return response["current"]


def list_ids():
    response = proxy_request("GET", f"{_keymaster_api}/ids")
    return response["ids"]


def load_wallet():
    response = proxy_request("GET", f"{_keymaster_api}/wallet")
    return response["wallet"]


def save_wallet(wallet):
    response = proxy_request(
        "PUT", f"{_keymaster_api}/wallet", json={"wallet": wallet}
    )
    return response["ok"]


def resolve_id(identifier):
    response = proxy_request("GET", f"{_keymaster_api}/ids/{identifier}")
    return response["docs"]


def create_schema(schema, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST", f"{_keymaster_api}/schemas", json={"schema": schema, "options": options}
    )
    return response["did"]


def create_template(schema):
    response = proxy_request(
        "POST", f"{_keymaster_api}/schemas/did/template", json={"schema": schema}
    )
    return response["template"]


def bind_credential(schema, subject, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/credentials/bind",
        json={"schema": schema, "subject": subject, "options": options},
    )
    return response["credential"]


def issue_credential(credential, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/credentials/issued",
        json={"credential": credential, "options": options},
    )
    return response["did"]


def decrypt_json(did):
    response = proxy_request(
        "POST", f"{_keymaster_api}/keys/decrypt/json", json={"did": did}
    )
    return response["json"]
