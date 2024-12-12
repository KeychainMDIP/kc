import keymaster_sdk as keymaster
from datetime import datetime, timedelta, timezone
import random
import string

# Test vars
expires = datetime.now(timezone.utc) + timedelta(minutes=1)
test_options = {"registry": "local", "validUntil": expires.isoformat()}
generated_ids = []


# Tests
def test_isready():
    response = keymaster.is_ready()
    assert_equal(response, True)


def test_ids():
    alice = generate_id()
    alice_id = keymaster.create_id(alice)

    response = keymaster.test_agent(alice_id)
    assert_equal(response, True)

    response = keymaster.set_current_id(alice)
    assert_equal(response, True)

    response = keymaster.get_current_id()
    assert_equal(response, alice)

    response = keymaster.resolve_id(alice)
    assert_equal(response["didDocument"]["id"], alice_id)

    response = keymaster.list_ids()
    assert alice in response, "expected ID not found in list_ids response"


def test_schemas():
    alice = generate_id()
    alice_id = keymaster.create_id(alice)
    keymaster.set_current_id(alice)

    did = keymaster.create_schema(None)
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
    alice_id = keymaster.create_id(alice)

    did = keymaster.encrypt_json(json, alice_id)
    data = keymaster.resolve_asset(did)
    assert_equal(data["encrypted"]["sender"], alice_id)

    response = keymaster.decrypt_json(did)
    assert_equal(response, json)


def test_issue_update_credentials():
    alice = generate_id()
    keymaster.create_id(alice)
    keymaster.set_current_id(alice)

    response = keymaster.list_credentials()
    assert_equal(response, [])

    alice_id = keymaster.resolve_id(alice)["didDocument"]["id"]
    schema = keymaster.create_schema(None, test_options)
    credential = keymaster.create_template(schema)
    assert_equal(credential["propertyName"], "TBD")
    assert_equal(credential["$schema"], schema)

    options = {
        **test_options,
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
    keymaster.create_id(alice)
    keymaster.create_id(bob)
    keymaster.set_current_id(alice)

    alice_id = keymaster.resolve_id(alice)["didDocument"]["id"]
    bob_id = keymaster.resolve_id(bob)["didDocument"]["id"]
    schema = keymaster.create_schema(None, test_options)

    bc = keymaster.bind_credential(schema, bob, test_options)
    assert_equal(bc["credentialSubject"]["id"], bob_id)

    did = keymaster.issue_credential(bc, test_options)
    vc = keymaster.get_credential(did)
    assert_equal(vc["issuer"], alice_id)
    assert_equal(vc["credentialSubject"]["id"], bob_id)


def test_publish_credentials():
    bob = generate_id()
    keymaster.create_id(bob)
    bob_schema = keymaster.create_schema(None, test_options)
    bc = keymaster.bind_credential(bob_schema, bob, test_options)
    did = keymaster.issue_credential(bc, test_options)
    identifier = keymaster.resolve_id(bob)["didDocument"]["id"]

    response = keymaster.publish_credential(did)
    assert_equal(response["signature"]["signer"], identifier)

    response = keymaster.unpublish_credential(did)
    assert_equal(response, f"OK credential {did} removed from manifest")


def test_accept_remove_revoke_credential():
    bob = generate_id()
    keymaster.create_id(bob)
    bob_schema = keymaster.create_schema(None, test_options)
    bc = keymaster.bind_credential(bob_schema, bob, test_options)
    did = keymaster.issue_credential(bc, test_options)

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


def test_registeries():
    response = keymaster.list_registries()
    assert (
        "hyperswarm" in response
    ), "hyperswarm not present in list_registries response"


def test_backup_recover_id():
    alice = generate_id()
    did = keymaster.create_id(alice)

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
    keymaster.create_id(alice)
    bob_id = keymaster.create_id(bob)
    keymaster.set_current_id(alice)

    msg = "Hi Bob"

    did = keymaster.encrypt_message(msg, bob_id)
    response = keymaster.decrypt_message(did)
    assert_equal(response, msg)

    keymaster.set_current_id(bob)
    response = keymaster.decrypt_message(did)
    assert_equal(response, msg)


def test_names():
    alice = generate_id()
    alice_id = keymaster.create_id(alice)

    response = keymaster.remove_name("Bob")

    response = keymaster.add_name("Bob", alice_id)
    assert_equal(response, True)

    response = keymaster.list_names()
    assert "Bob" in response, "expected name not found in list_names response"

    response = keymaster.remove_name("Bob")
    assert_equal(response, True)


def test_challenge_response():
    alice = generate_id()
    alice_id = keymaster.create_id(alice)
    keymaster.set_current_id(alice)

    challenge_did = keymaster.create_challenge({})
    doc = keymaster.resolve_did(challenge_did)
    assert_equal(doc["didDocument"]["id"], challenge_did)
    assert_equal(doc["didDocument"]["controller"], alice_id)
    assert_equal(doc["didDocumentData"], {"challenge": {}})

    bob = generate_id()
    bob_id = keymaster.create_id(bob)
    keymaster.set_current_id(bob)

    response_did = keymaster.create_response(challenge_did)
    response = keymaster.decrypt_json(response_did)
    assert_equal(response["response"]["challenge"], challenge_did)
    assert_equal(response["response"]["credentials"], [])

    response = keymaster.verify_response(response_did)
    assert_equal(response["challenge"], challenge_did)
    assert_equal(response["responder"], bob_id)


def test_groups():
    alice = generate_id()
    alice_id = keymaster.create_id(alice)
    keymaster.set_current_id(alice)

    name = "test_group"
    did = keymaster.create_group(name)
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
    keymaster.create_id(alice)
    keymaster.set_current_id(alice)

    keymaster.rotate_keys()
    wallet = keymaster.load_wallet()
    assert_equal(wallet["ids"][alice]["index"], 1)


def test_signature():
    alice = generate_id()
    keymaster.create_id(alice)
    keymaster.set_current_id(alice)

    signed = keymaster.add_signature(str({}))
    valid = keymaster.verify_signature(signed)
    assert_equal(valid, True)


def test_polls():
    alice = generate_id()
    alice_id = keymaster.create_id(alice)
    keymaster.set_current_id(alice)
    name = "test_group"
    group = keymaster.create_group(name)
    keymaster.add_group_member(group, alice_id)

    template = keymaster.poll_template()
    template["roster"] = group

    poll = keymaster.create_poll(template)
    ballot = keymaster.vote_poll(poll, 1)
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


# Test and helper functions
def generate_id():

    generated_ids.append(
        "".join(random.choice(string.ascii_letters + string.digits) for _ in range(11))
    )
    return generated_ids[len(generated_ids) - 1]


def assert_equal(thing1, thing2):
    if thing1 != thing2:
        raise AssertionError(f"not({thing1} == {thing2})")
