import os
import requests
import json

_base_url = os.environ.get("KC_KEYMASTER_URL", "http://localhost:4226")
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


def set_current_id(name):
    response = proxy_request(
        "PUT", f"{_keymaster_api}/ids/current", json={"name": name}
    )
    return response["ok"]


def remove_id(identifier):
    response = proxy_request("DELETE", f"{_keymaster_api}/ids/{identifier}")
    return response["ok"]


def rename_id(identifier, name):
    response = proxy_request(
        "POST", f"{_keymaster_api}/ids/{identifier}/rename", json={"name": name}
    )
    return response["ok"]


def backup_id(identifier):
    response = proxy_request("POST", f"{_keymaster_api}/ids/{identifier}/backup")
    return response["ok"]


def recover_id(did):
    response = proxy_request(
        "POST", f"{_keymaster_api}/ids/{did}/recover", json={"did": did}
    )
    return response["recovered"]


def encrypt_message(msg, receiver, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/keys/encrypt/message",
        json={"msg": msg, "receiver": receiver, "options": options},
    )
    return response["did"]


def decrypt_message(did):
    response = proxy_request(
        "POST", f"{_keymaster_api}/keys/decrypt/message", json={"did": did}
    )
    return response["message"]


def list_ids():
    response = proxy_request("GET", f"{_keymaster_api}/ids")
    return response["ids"]


def load_wallet():
    response = proxy_request("GET", f"{_keymaster_api}/wallet")
    return response["wallet"]


def save_wallet(wallet):
    response = proxy_request("PUT", f"{_keymaster_api}/wallet", json={"wallet": wallet})
    return response["ok"]


def backup_wallet():
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/wallet/backup",
    )
    return response["ok"]


def recover_wallet():
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/wallet/recover",
    )
    return response["wallet"]


def new_wallet(mnemonic, overwrite=False):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/wallet/new",
        json={"mnemonic": mnemonic, "overwrite": overwrite},
    )
    return response["wallet"]


def check_wallet():
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/wallet/check",
    )
    return response["check"]


def fix_wallet():
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/wallet/fix",
    )
    return response["fix"]


def decrypt_mnemonic():
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/wallet/mnemonic",
    )
    return response["mnemonic"]


def list_registries():
    response = proxy_request("GET", f"{_keymaster_api}/registries")
    return response["registries"]


def resolve_did(name):
    response = proxy_request("GET", f"{_keymaster_api}/did/{name}")
    return response["docs"]


def resolve_asset(name):
    response = proxy_request("GET", f"{_keymaster_api}/assets/{name}")
    return response["asset"]


def create_schema(schema, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST", f"{_keymaster_api}/schemas", json={"schema": schema, "options": options}
    )
    return response["did"]


def get_schema(identifier):
    response = proxy_request("GET", f"{_keymaster_api}/schemas/{identifier}")
    return response["schema"]


def set_schema(identifier, schema):
    response = proxy_request(
        "PUT", f"{_keymaster_api}/schemas/{identifier}", json={"schema": schema}
    )
    return response["ok"]


def test_schema(identifier):
    response = proxy_request("POST", f"{_keymaster_api}/schemas/{identifier}/test")
    return response["test"]


def list_schemas(owner=None):
    if owner is None:
        owner = ""
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/schemas?owner={owner}",
    )
    return response["schemas"]


def test_agent(identifier):
    response = proxy_request("POST", f"{_keymaster_api}/agents/{identifier}/test")
    return response["test"]


def create_template(id):
    response = proxy_request(
        "POST", f"{_keymaster_api}/schemas/{id}/template", json={"id": id}
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


def update_credential(did, credential):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/credentials/issued/{did}",
        json={"credential": credential},
    )
    return response["ok"]


def get_credential(did):
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/credentials/held/{did}",
    )
    return response["credential"]


def list_credentials():
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/credentials/held",
    )
    return response["held"]


def publish_credential(did, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/credentials/held/{did}/publish",
        json={"options": options},
    )
    return response["ok"]


def unpublish_credential(did):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/credentials/held/{did}/unpublish",
    )
    return response["ok"]


def remove_credential(did):
    response = proxy_request(
        "DELETE",
        f"{_keymaster_api}/credentials/held/{did}",
    )
    return response["ok"]


def revoke_credential(did):
    response = proxy_request(
        "DELETE",
        f"{_keymaster_api}/credentials/issued/{did}",
    )
    return response["ok"]


def list_issued():
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/credentials/issued",
    )
    return response["issued"]


def accept_credential(did):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/credentials/held",
        json={"did": did},
    )
    return response["ok"]


def decrypt_json(did):
    response = proxy_request(
        "POST", f"{_keymaster_api}/keys/decrypt/json", json={"did": did}
    )
    return response["json"]


def encrypt_json(json, receiver, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/keys/encrypt/json",
        json={"json": json, "receiver": receiver, "options": options},
    )
    return response["did"]


def list_names():
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/names",
    )
    return response["names"]


def add_name(name, did):
    response = proxy_request(
        "POST", f"{_keymaster_api}/names", json={"name": name, "did": did}
    )
    return response["ok"]


def get_name(name):
    response = proxy_request("GET", f"{_keymaster_api}/names/{name}")
    return response["did"]


def remove_name(name):
    response = proxy_request("DELETE", f"{_keymaster_api}/names/{name}")
    return response["ok"]


def create_challenge(challenge, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/challenge",
        json={"challenge": challenge, "options": options},
    )
    return response["did"]


def create_response(challenge, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/response",
        json={"challenge": challenge, "options": options},
    )
    return response["did"]


def verify_response(response, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/response/verify",
        json={"response": response, "options": options},
    )
    return response["verify"]


def create_group(name, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/groups",
        json={"name": name, "options": options},
    )
    return response["did"]


def get_group(group):
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/groups/{group}",
    )
    return response["group"]


def add_group_member(group, member):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/groups/{group}/add",
        json={"group": group, "member": member},
    )
    return response["ok"]


def remove_group_member(group, member):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/groups/{group}/remove",
        json={"group": group, "member": member},
    )
    return response["ok"]


def test_group(group, member):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/groups/{group}/test",
        json={"group": group, "member": member},
    )
    return response["test"]


def list_groups(owner=None):
    if owner is None:
        owner = ""
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/groups?owner={owner}",
    )
    return response["groups"]


def rotate_keys():
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/keys/rotate",
    )
    return response["ok"]


def add_signature(contents):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/keys/sign",
        json={"contents": contents},
    )
    return response["signed"]


def verify_signature(json):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/keys/verify",
        json={"json": json},
    )
    return response["ok"]


def poll_template():
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/templates/poll",
    )
    return response["template"]


def create_poll(poll, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/polls",
        json={"poll": poll, "options": options},
    )
    return response["did"]


def list_polls(owner=None):
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/polls?owner={owner}",
    )
    return response["polls"]


def get_poll(poll):
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/polls/{poll}",
    )
    return response["poll"]


def test_poll(identifier):
    response = proxy_request("POST", f"{_keymaster_api}/polls/{identifier}/test")
    return response["test"]


def view_poll(poll):
    response = proxy_request(
        "GET",
        f"{_keymaster_api}/polls/{poll}/view",
    )
    return response["poll"]


def vote_poll(poll, vote, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/polls/{poll}/vote",
        json={"poll": poll, "vote": vote, "options": options},
    )
    return response["did"]


def update_poll(ballot):
    response = proxy_request(
        "PUT", f"{_keymaster_api}/polls/update", json={"ballot": ballot}
    )
    return response["ok"]


def publish_poll(poll, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/polls/{poll}/publish",
        json={"options": options},
    )
    return response["ok"]


def unpublish_poll(poll):
    response = proxy_request("POST", f"{_keymaster_api}/polls/{poll}/unpublish")
    return response["ok"]


def revoke_did(did):
    response = proxy_request("DELETE", f"{_keymaster_api}/did/{did}")
    return response["ok"]


def list_dmail(owner=None):
    url = f"{_keymaster_api}/dmail"
    if owner:
        url = f"{url}?owner={owner}"
    response = proxy_request("GET", url)
    return response["dmail"]


def create_dmail(message, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/dmail",
        json={"message": message, "options": options},
    )
    return response["did"]


def import_dmail(did):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/dmail/import",
        json={"did": did},
    )
    return response["ok"]


def get_dmail_message(identifier):
    response = proxy_request("GET", f"{_keymaster_api}/dmail/{identifier}")
    return response["message"]


def update_dmail(identifier, message):
    response = proxy_request(
        "PUT",
        f"{_keymaster_api}/dmail/{identifier}",
        json={"message": message},
    )
    return response["ok"]


def remove_dmail(identifier):
    response = proxy_request("DELETE", f"{_keymaster_api}/dmail/{identifier}")
    return response["ok"]


def send_dmail(identifier):
    response = proxy_request("POST", f"{_keymaster_api}/dmail/{identifier}/send")
    return response["did"]


def file_dmail(identifier, tags):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/dmail/{identifier}/file",
        json={"tags": tags},
    )
    return response["ok"]


def list_dmail_attachments(identifier):
    response = proxy_request("GET", f"{_keymaster_api}/dmail/{identifier}/attachments")
    return response["attachments"]


def add_dmail_attachment(identifier, name, data):
    if isinstance(data, (bytes, bytearray)):
        raw = data
    else:
        with open(data, "rb") as f:
            raw = f.read()

    safe_name = str(name).replace("\\", "\\\\").replace('"', '\\"')
    headers = {
        "Content-Type": "application/octet-stream",
        "X-Options": f'{{"name":"{safe_name}"}}',
    }

    response = proxy_request(
        "POST",
        f"{_keymaster_api}/dmail/{identifier}/attachments",
        data=raw,
        headers=headers,
    )
    return response["ok"]


def remove_dmail_attachment(identifier, name):
    safe = requests.utils.quote(str(name), safe="")
    response = proxy_request(
        "DELETE",
        f"{_keymaster_api}/dmail/{identifier}/attachments/{safe}",
    )
    return response["ok"]


def get_dmail_attachment(identifier, name):
    safe = requests.utils.quote(str(name), safe="")
    url = f"{_keymaster_api}/dmail/{identifier}/attachments/{safe}"
    resp = requests.get(url)
    try:
        resp.raise_for_status()
    except requests.HTTPError:
        raise KeymasterError(f"Error {resp.status_code}: {resp.text}")
    return resp.content


def create_notice(message, options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/notices",
        json={"message": message, "options": options},
    )
    return response["did"]


def update_notice(identifier, message):
    response = proxy_request(
        "PUT",
        f"{_keymaster_api}/notices/{identifier}",
        json={"message": message},
    )
    return response["ok"]


def refresh_notices():
    response = proxy_request("POST", f"{_keymaster_api}/notices/refresh")
    return response["ok"]


def create_group_vault(options=None):
    if options is None:
        options = {}
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/groupVaults",
        json={"options": options},
    )
    return response["did"]


def get_group_vault(identifier):
    response = proxy_request("GET", f"{_keymaster_api}/groupVaults/{identifier}")
    return response["groupVault"]


def test_group_vault(identifier):
    response = proxy_request("POST", f"{_keymaster_api}/groupVaults/{identifier}/test")
    return response["test"]


def add_group_vault_member(vault_id, member_id):
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/groupVaults/{vault_id}/members",
        json={"memberId": member_id},
    )
    return response["ok"]


def remove_group_vault_member(vault_id, member_id):
    safe_member = requests.utils.quote(str(member_id), safe="")
    response = proxy_request(
        "DELETE",
        f"{_keymaster_api}/groupVaults/{vault_id}/members/{safe_member}",
    )
    return response["ok"]


def list_group_vault_members(vault_id):
    response = proxy_request("GET", f"{_keymaster_api}/groupVaults/{vault_id}/members")
    return response["members"]


def add_group_vault_item(vault_id, name, data):
    if isinstance(data, (bytes, bytearray)):
        raw = data
    else:
        with open(data, "rb") as f:
            raw = f.read()

    safe_name = str(name).replace("\\", "\\\\").replace('"', '\\"')
    headers = {
        "Content-Type": "application/octet-stream",
        "X-Options": f'{{"name":"{safe_name}"}}',
    }
    response = proxy_request(
        "POST",
        f"{_keymaster_api}/groupVaults/{vault_id}/items",
        data=raw,
        headers=headers,
    )
    return response["ok"]


def remove_group_vault_item(vault_id, name):
    safe = requests.utils.quote(str(name), safe="")
    response = proxy_request(
        "DELETE",
        f"{_keymaster_api}/groupVaults/{vault_id}/items/{safe}",
    )
    return response["ok"]


def list_group_vault_items(vault_id):
    response = proxy_request("GET", f"{_keymaster_api}/groupVaults/{vault_id}/items")
    return response["items"]


def get_group_vault_item(vault_id, name):
    safe = requests.utils.quote(str(name), safe="")
    url = f"{_keymaster_api}/groupVaults/{vault_id}/items/{safe}"
    resp = requests.get(url)
    try:
        resp.raise_for_status()
    except requests.HTTPError:
        raise KeymasterError(f"Error {resp.status_code}: {resp.text}")
    return resp.content


def get_cas_data(cid):
    safe_cid = requests.utils.quote(str(cid), safe="")
    url = f"{_keymaster_api}/cas/data/{safe_cid}"
    resp = requests.get(url)
    try:
        resp.raise_for_status()
    except requests.HTTPError:
        raise KeymasterError(f"Error {resp.status_code}: {resp.text}")
    return resp.content


def create_image(data, options=None):
    if options is None:
        options = {}
    headers = {"Content-Type": "application/octet-stream"}
    if options:
        headers["X-Options"] = json.dumps(options)
    resp = requests.post(f"{_keymaster_api}/images", data=data, headers=headers)
    try:
        resp.raise_for_status()
    except requests.HTTPError:
        raise KeymasterError(f"Error {resp.status_code}: {resp.text}")
    return resp.json()["did"]


def update_image(identifier, data):
    headers = {"Content-Type": "application/octet-stream"}
    resp = requests.put(f"{_keymaster_api}/images/{identifier}", data=data, headers=headers)
    try:
        resp.raise_for_status()
    except requests.HTTPError:
        raise KeymasterError(f"Error {resp.status_code}: {resp.text}")
    return resp.json()["ok"]


def get_image(identifier):
    response = proxy_request("GET", f"{_keymaster_api}/images/{identifier}")
    return response["image"]


def test_image(identifier):
    response = proxy_request("POST", f"{_keymaster_api}/images/{identifier}/test")
    return response["test"]


def create_document(data, options=None):
    if options is None:
        options = {}
    headers = {"Content-Type": "application/octet-stream"}
    if options:
        headers["X-Options"] = json.dumps(options)
    resp = requests.post(f"{_keymaster_api}/documents", data=data, headers=headers)
    try:
        resp.raise_for_status()
    except requests.HTTPError:
        raise KeymasterError(f"Error {resp.status_code}: {resp.text}")
    return resp.json()["did"]


def update_document(identifier, data, options=None):
    if options is None:
        options = {}
    headers = {"Content-Type": "application/octet-stream"}
    if options:
        headers["X-Options"] = json.dumps(options)
    resp = requests.put(f"{_keymaster_api}/documents/{identifier}", data=data, headers=headers)
    try:
        resp.raise_for_status()
    except requests.HTTPError:
        raise KeymasterError(f"Error {resp.status_code}: {resp.text}")
    return resp.json()["ok"]


def get_document(identifier):
    response = proxy_request("GET", f"{_keymaster_api}/documents/{identifier}")
    return response["document"]


def test_document(identifier):
    response = proxy_request("POST", f"{_keymaster_api}/documents/{identifier}/test")
    return response["test"]
