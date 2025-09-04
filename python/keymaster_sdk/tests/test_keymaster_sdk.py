import keymaster_sdk as keymaster
from datetime import datetime, timedelta, timezone
import random
import string
import base64

# Test vars
expires = datetime.now(timezone.utc) + timedelta(minutes=1)
local_options = {"registry": "local"}
expire_options = {**local_options, "validUntil": expires.isoformat()}
generated_ids = []

# Pre-test check
def test_registries_include_local():
    registries = keymaster.list_registries()
    assert "local" in registries, "local registry must be enabled for tests"


# Tests
def test_isready():
    response = keymaster.is_ready()
    assert_equal(response, True)


def test_ids():
    alice = generate_id()
    alice_id = keymaster.create_id(alice, local_options)

    response = keymaster.test_agent(alice_id)
    assert_equal(response, True)

    response = keymaster.set_current_id(alice)
    assert_equal(response, True)

    response = keymaster.get_current_id()
    assert_equal(response, alice)

    response = keymaster.resolve_did(alice)
    assert_equal(response["didDocument"]["id"], alice_id)

    response = keymaster.list_ids()
    assert alice in response, "expected ID not found in list_ids response"


def test_schemas():
    alice = generate_id()
    alice_id = keymaster.create_id(alice, local_options)

    did = keymaster.create_schema(None, local_options)
    schema = keymaster.get_schema(did)
    assert_equal(schema["$schema"], "http://json-schema.org/draft-07/schema#")
    assert_equal(schema["type"], "object")
    assert_equal(schema["properties"], {"propertyName": {"type": "string"}})
    assert_equal(schema["required"], ["propertyName"])

    response = keymaster.list_schemas(alice_id)
    assert_equal(response, [did])

    response = keymaster.test_schema(did)
    assert_equal(response, True)

    response = keymaster.set_schema(did, schema)
    assert_equal(response, True)


def test_encrypt_decrypt_json():
    json = {"key": "value", "list": [1, 2, 3], "obj": {"name": "some object"}}

    alice = generate_id()
    alice_id = keymaster.create_id(alice, local_options)

    did = keymaster.encrypt_json(json, alice_id, local_options)
    data = keymaster.resolve_asset(did)
    assert_equal(data["encrypted"]["sender"], alice_id)

    response = keymaster.decrypt_json(did)
    assert_equal(response, json)


def test_issue_update_credentials():
    alice = generate_id()
    alice_id = keymaster.create_id(alice, local_options)

    response = keymaster.list_credentials()
    assert_equal(response, [])

    schema = keymaster.create_schema(None, expire_options)
    credential = keymaster.create_template(schema)
    assert_equal(credential["propertyName"], "TBD")
    assert_equal(credential["$schema"], schema)

    options = {
        "registry": "local",
        "subject": alice,
        "schema": schema,
    }

    did = keymaster.issue_credential(credential, options)
    vc = keymaster.get_credential(did)
    assert_equal(vc["issuer"], alice_id)
    assert_equal(vc["credentialSubject"]["id"], alice_id)

    response = keymaster.list_issued()
    assert_equal(response, [did])

    response = keymaster.decrypt_json(did)
    assert_equal(response["type"], ["VerifiableCredential", schema])
    assert_equal(response["issuer"], alice_id)
    assert_equal(response["credentialSubject"]["id"], alice_id)

    response = keymaster.update_credential(did, vc)
    assert_equal(response, True)


def test_bind_credentials():
    alice = generate_id()
    bob = generate_id()
    bob_id = keymaster.create_id(bob, local_options)
    alice_id = keymaster.create_id(alice, local_options)

    schema = keymaster.create_schema(None, expire_options)

    bc = keymaster.bind_credential(schema, bob, expire_options)
    assert_equal(bc["credentialSubject"]["id"], bob_id)

    did = keymaster.issue_credential(bc, expire_options)
    vc = keymaster.get_credential(did)
    assert_equal(vc["issuer"], alice_id)
    assert_equal(vc["credentialSubject"]["id"], bob_id)


def test_publish_credentials():
    bob = generate_id()
    identifier = keymaster.create_id(bob, local_options)
    bob_schema = keymaster.create_schema(None, expire_options)
    bc = keymaster.bind_credential(bob_schema, bob, expire_options)
    did = keymaster.issue_credential(bc, expire_options)

    response = keymaster.publish_credential(did)
    assert_equal(response["signature"]["signer"], identifier)

    response = keymaster.unpublish_credential(did)
    assert_equal(response, f"OK credential {did} removed from manifest")


def test_accept_remove_revoke_credential():
    bob = generate_id()
    keymaster.create_id(bob, local_options)
    bob_schema = keymaster.create_schema(None, expire_options)
    bc = keymaster.bind_credential(bob_schema, bob, expire_options)
    did = keymaster.issue_credential(bc, expire_options)

    response = keymaster.accept_credential(did)
    assert_equal(response, True)

    response = keymaster.remove_credential(did)
    assert_equal(response, True)

    response = keymaster.revoke_credential(did)
    assert_equal(response, True)


def test_wallet():
    wallet = keymaster.load_wallet()
    assert "seed" in wallet, "seed not present in wallet"
    assert "mnemonic" in wallet["seed"], "mnemonic not present in wallet"
    assert "hdkey" in wallet["seed"], "hdkey not present in wallet"
    assert "xpriv" in wallet["seed"]["hdkey"], "xpriv not present in wallet"

    response = keymaster.save_wallet(wallet)
    assert_equal(response, True)

    did = keymaster.backup_wallet()
    doc = keymaster.resolve_did(did)
    assert_equal(doc["didDocument"]["id"], did)

    mnemonic = keymaster.decrypt_mnemonic()
    assert_equal(len(mnemonic.split()), 12)

    new_wallet = keymaster.new_wallet(mnemonic, True)
    assert_equal(wallet["seed"]["hdkey"]["xpriv"], new_wallet["seed"]["hdkey"]["xpriv"])

    recovered = keymaster.recover_wallet()
    assert_equal(recovered, wallet)

    response = keymaster.check_wallet()
    assert "checked" in response, "checked not present in check_wallet response"

    response = keymaster.fix_wallet()
    assert "idsRemoved" in response, "idsRemoved not present in fix_wallet response"


def test_backup_recover_id():
    alice = generate_id()
    did = keymaster.create_id(alice, local_options)

    response = keymaster.backup_id(alice)
    assert_equal(response, True)

    doc = keymaster.resolve_did(did)
    vault = keymaster.resolve_did(doc["didDocumentData"]["vault"])
    assert len(vault["didDocumentData"]["backup"]) > 0, "backup not present in vault"

    keymaster.remove_id(generated_ids.pop())
    assert_equal(response, True)

    response = keymaster.list_ids()
    assert alice not in response, "unexpected ID found in list_ids response"

    response = keymaster.recover_id(did)
    assert_equal(response, alice)

    response = keymaster.list_ids()
    assert alice in response, "expected ID not found in list_ids response"


def test_encrypt_decrypt_message():
    alice = generate_id()
    bob = generate_id()
    keymaster.create_id(alice, local_options)
    bob_id = keymaster.create_id(bob, local_options)

    msg = "Hi Bob"

    did = keymaster.encrypt_message(msg, bob_id, local_options)
    response = keymaster.decrypt_message(did)
    assert_equal(response, msg)

    keymaster.set_current_id(bob)
    response = keymaster.decrypt_message(did)
    assert_equal(response, msg)


def test_names():
    alice = generate_id()
    alice_id = keymaster.create_id(alice, local_options)

    response = keymaster.remove_name("Bob")

    response = keymaster.add_name("Bob", alice_id)
    assert_equal(response, True)

    response = keymaster.list_names()
    assert "Bob" in response, "expected name not found in list_names response"

    response = keymaster.remove_name("Bob")
    assert_equal(response, True)


def test_challenge_response():
    alice = generate_id()
    alice_id = keymaster.create_id(alice, local_options)

    challenge_did = keymaster.create_challenge({}, local_options)
    doc = keymaster.resolve_did(challenge_did)
    assert_equal(doc["didDocument"]["id"], challenge_did)
    assert_equal(doc["didDocument"]["controller"], alice_id)
    assert_equal(doc["didDocumentData"], {"challenge": {}})

    bob = generate_id()
    bob_id = keymaster.create_id(bob, local_options)

    response_did = keymaster.create_response(challenge_did, local_options)
    response = keymaster.decrypt_json(response_did)
    assert_equal(response["response"]["challenge"], challenge_did)
    assert_equal(response["response"]["credentials"], [])

    response = keymaster.verify_response(response_did)
    assert_equal(response["challenge"], challenge_did)
    assert_equal(response["responder"], bob_id)


def test_groups():
    alice = generate_id()
    alice_id = keymaster.create_id(alice, local_options)

    name = "test_group"
    did = keymaster.create_group(name, local_options)
    doc = keymaster.resolve_did(did)
    assert_equal(doc["didDocument"]["id"], did)
    assert_equal(doc["didDocument"]["controller"], alice_id)

    response = keymaster.list_groups()
    assert did in response, "expected group not found in list_groups response"

    response = keymaster.add_group_member(did, alice_id)
    assert_equal(response, True)

    response = keymaster.test_group(did, alice_id)
    assert_equal(response, True)

    response = keymaster.get_group(did)
    assert_equal(response["name"], name)
    assert_equal(response["members"], [alice_id])

    response = keymaster.remove_group_member(did, alice_id)
    assert_equal(response, True)

    response = keymaster.get_group(did)
    assert_equal(response["name"], name)
    assert_equal(response["members"], [])


def test_rotate_keys():
    alice = generate_id()
    keymaster.create_id(alice, local_options)

    keymaster.rotate_keys()
    wallet = keymaster.load_wallet()
    assert_equal(wallet["ids"][alice]["index"], 1)


def test_signature():
    alice = generate_id()
    keymaster.create_id(alice, local_options)

    signed = keymaster.add_signature(str({}))
    valid = keymaster.verify_signature(signed)
    assert_equal(valid, True)


def test_polls():
    alice = generate_id()
    alice_id = keymaster.create_id(alice, local_options)

    name = "test_group"
    group = keymaster.create_group(name, local_options)
    keymaster.add_group_member(group, alice_id)

    template = keymaster.poll_template()
    template["roster"] = group

    poll = keymaster.create_poll(template, local_options)
    ballot = keymaster.vote_poll(poll, 1, local_options)
    response = keymaster.update_poll(ballot)
    assert_equal(response, True)
    response = keymaster.publish_poll(poll)
    assert_equal(response, True)
    response = keymaster.unpublish_poll(poll)
    assert_equal(response, True)
    response = keymaster.view_poll(poll)
    assert_equal(response["results"]["ballots"][0]["voter"], alice_id)


def test_remove_ids():
    for identifier in generated_ids:
        response = keymaster.remove_id(identifier)
        assert_equal(response, True)


def test_revoke_did():
    owner = generate_id()
    keymaster.create_id(owner, local_options)

    did = keymaster.create_schema(None, local_options)

    ok = keymaster.revoke_did(did)
    assert_equal(ok, True)

    doc = keymaster.resolve_did(did)
    assert doc["didDocument"] == {}, "didDocument should be empty after revocation"
    assert doc["didDocumentMetadata"].get("deactivated") is True, "DID not marked deactivated"


def test_documents():
    data = b"hello world"
    did = keymaster.create_document(data, local_options)
    assert did.startswith("did:"), "Invalid DID returned from create_document"

    doc = keymaster.get_document(did)
    assert "cid" in doc, "Missing CID in document metadata"
    assert "bytes" in doc and doc["bytes"] > 0, "Document size missing or invalid"

    new_data = b"updated document"
    ok = keymaster.update_document(did, new_data, local_options)
    assert_equal(ok, True)

    result = keymaster.test_document(did)
    assert_equal(result, True)


def test_images():

    png_1x1 = base64.b64decode(
        b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII="
    )
    did = keymaster.create_image(png_1x1, local_options)
    assert did.startswith("did:"), "Invalid DID returned from create_image"

    meta = keymaster.get_image(did)
    assert isinstance(meta.get("type"), str) and meta["type"].startswith("image/"), "Missing/invalid MIME type"
    assert meta.get("width") == 1 and meta.get("height") == 1, "Unexpected image dimensions"
    assert meta.get("bytes", 0) > 0, "Image byte size missing/invalid"
    assert "cid" in meta, "CID missing from image metadata"

    png_2x1 = base64.b64decode(
        b"iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAD4c0wSAAAADUlEQVR4nGNgYGBgAAAABQABVqg3tQAAAABJRU5ErkJggg=="
    )
    ok = keymaster.update_image(did, png_2x1)
    assert_equal(ok, True)

    valid = keymaster.test_image(did)
    assert_equal(valid, True)


def test_group_vaults():
    owner = generate_id()
    keymaster.create_id(owner, local_options)

    vault_id = keymaster.create_group_vault(local_options)
    assert vault_id.startswith("did:")

    gv = keymaster.get_group_vault(vault_id)
    assert isinstance(gv, dict) and "keys" in gv and "items" in gv
    assert_equal(keymaster.test_group_vault(vault_id), True)

    member = generate_id()
    member_did = keymaster.create_id(member, local_options)

    keymaster.set_current_id(owner)

    assert_equal(keymaster.add_group_vault_member(vault_id, member_did), True)

    members = keymaster.list_group_vault_members(vault_id)
    assert isinstance(members, dict) and member_did in members

    name = "hello.txt"
    data = b"hello world"
    assert_equal(keymaster.add_group_vault_item(vault_id, name, data), True)

    items = keymaster.list_group_vault_items(vault_id)
    assert isinstance(items, dict) and name in items

    blob = keymaster.get_group_vault_item(vault_id, name)
    assert blob == data

    assert_equal(keymaster.remove_group_vault_item(vault_id, name), True)

    assert_equal(keymaster.remove_group_vault_member(vault_id, member_did), True)


def test_notices_create_update_and_refresh():
    alice = generate_id()
    bob = generate_id()
    alice_id = keymaster.create_id(alice, local_options)
    bob_id = keymaster.create_id(bob, local_options)

    did1 = keymaster.create_document(b"doc-1", local_options)
    did2 = keymaster.create_document(b"doc-2", local_options)

    message1 = {"to": [alice_id, bob_id], "dids": [did1, did2]}
    notice_did = keymaster.create_notice(message1, local_options)
    assert notice_did.startswith("did:")

    message2 = {"to": [alice_id], "dids": [did1]}
    ok = keymaster.update_notice(notice_did, message2)
    assert_equal(ok, True)

    refreshed = keymaster.refresh_notices()
    assert_equal(refreshed, True)


def test_dmail():
    sender = generate_id()
    recipient = generate_id()
    sender_did = keymaster.create_id(sender, local_options)
    recipient_did = keymaster.create_id(recipient, local_options)
    keymaster.set_current_id(sender)

    msg = {"to": [recipient_did], "cc": [], "subject": "Hello", "body": "Test message"}
    dmail_did = keymaster.create_dmail(msg, local_options)
    assert dmail_did.startswith("did:")

    dm = keymaster.get_dmail_message(dmail_did)
    assert dm["subject"] == "Hello"
    listing = keymaster.list_dmail()
    assert dmail_did in listing

    ok = keymaster.update_dmail(dmail_did, {"to": [recipient_did], "cc": [], "subject": "Updated", "body": "Updated body"})
    assert_equal(ok, True)

    ok = keymaster.add_dmail_attachment(dmail_did, "note.txt", b"hi")
    assert_equal(ok, True)
    atts = keymaster.list_dmail_attachments(dmail_did)
    assert "note.txt" in atts
    blob = keymaster.get_dmail_attachment(dmail_did, "note.txt")
    assert blob == b"hi"
    ok = keymaster.remove_dmail_attachment(dmail_did, "note.txt")
    assert_equal(ok, True)

    ok = keymaster.file_dmail(dmail_did, ["archived"])
    assert_equal(ok, True)
    ok = keymaster.import_dmail(dmail_did)
    assert_equal(ok, True)

    ok = keymaster.remove_dmail(dmail_did)
    assert_equal(ok, True)


# Test and helper functions
def generate_id():

    generated_ids.append(
        "".join(random.choice(string.ascii_letters + string.digits) for _ in range(11))
    )
    return generated_ids[len(generated_ids) - 1]


def assert_equal(thing1, thing2):
    if thing1 != thing2:
        raise AssertionError(f"not({thing1} == {thing2})")
