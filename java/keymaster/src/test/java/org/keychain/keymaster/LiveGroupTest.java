package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.model.Group;
import org.keychain.keymaster.testutil.LiveTestSupport;

@Tag("live")
class LiveGroupTest {
    @TempDir
    private Path tempDir;

    private Keymaster newKeymaster() {
        return LiveTestSupport.keymaster(tempDir);
    }

    @Test
    void createGroupCreatesNamedGroup() {
        Keymaster keymaster = newKeymaster();
        String ownerDid = keymaster.createId("Bob");
        String groupName = "mockGroup";
        String groupDid = keymaster.createGroup(groupName);
        MdipDocument doc = keymaster.resolveDID(groupDid);

        assertEquals(groupDid, doc.didDocument.id);
        assertEquals(ownerDid, doc.didDocument.controller);

        Map<String, Object> expectedGroup = Map.of(
            "group",
            Map.of(
                "name",
                groupName,
                "members",
                List.of()
            )
        );

        assertEquals(expectedGroup, doc.didDocumentData);
    }

    @Test
    void createGroupWithDifferentDidName() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupName = "mockGroup";
        String didName = "mockName";

        CreateAssetOptions options = new CreateAssetOptions();
        options.name = didName;
        keymaster.createGroup(groupName, options);

        MdipDocument doc = keymaster.resolveDID(didName);
        Map<String, Object> expectedGroup = Map.of(
            "group",
            Map.of(
                "name",
                groupName,
                "members",
                List.of()
            )
        );

        assertEquals(expectedGroup, doc.didDocumentData);
    }

    @Test
    void getGroupReturnsGroup() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupName = "mock";
        String groupDid = keymaster.createGroup(groupName);

        Group group = keymaster.getGroup(groupDid);

        assertNotNull(group);
        assertEquals(groupName, group.name);
        assertEquals(List.of(), group.members);
    }

    @Test
    void getGroupReturnsNullOnInvalidDid() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Bob");

        Group group = keymaster.getGroup(did);

        assertNull(group);
    }

    @Test
    void getGroupReturnsOldStyleGroup() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> oldGroup = Map.of(
            "name",
            "mock",
            "members",
            List.of()
        );
        String groupDid = keymaster.createAsset(oldGroup);

        Group group = keymaster.getGroup(groupDid);

        assertNotNull(group);
        assertEquals("mock", group.name);
        assertEquals(List.of(), group.members);
    }

    @Test
    void getGroupReturnsNullForNonGroupDid() {
        Keymaster keymaster = newKeymaster();
        String agentDid = keymaster.createId("Bob");

        Group group = keymaster.getGroup(agentDid);

        assertNull(group);
    }

    @Test
    void addGroupMemberAddsDidMember() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupName = "mockGroup";
        String groupDid = keymaster.createGroup(groupName);
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        boolean ok = keymaster.addGroupMember(groupDid, dataDid);

        assertTrue(ok);
        Group group = keymaster.getGroup(groupDid);
        assertNotNull(group);
        assertEquals(groupName, group.name);
        assertEquals(List.of(dataDid), group.members);
    }

    @Test
    void addGroupMemberAddsAliasMember() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupName = "mockGroup";
        String groupDid = keymaster.createGroup(groupName);
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        String alias = "mockAlias";
        keymaster.addName(alias, dataDid);
        boolean ok = keymaster.addGroupMember(groupDid, alias);

        assertTrue(ok);
        Group group = keymaster.getGroup(groupDid);
        assertNotNull(group);
        assertEquals(List.of(dataDid), group.members);
    }

    @Test
    void addGroupMemberRejectsUnknownAlias() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("mockGroup");

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.addGroupMember(groupDid, "mockAlias")
        );

        assertEquals("unknown id", error.getMessage());
    }

    @Test
    void addGroupMemberViaGroupAlias() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupName = "mockGroup";
        String groupDid = keymaster.createGroup(groupName);
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        String alias = "mockAlias";
        keymaster.addName(alias, groupDid);
        boolean ok = keymaster.addGroupMember(alias, dataDid);

        assertTrue(ok);
        Group group = keymaster.getGroup(groupDid);
        assertNotNull(group);
        assertEquals(List.of(dataDid), group.members);
    }

    @Test
    void addGroupMemberRejectsUnknownGroupAlias() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.addGroupMember("mockAlias", dataDid)
        );

        assertEquals("unknown id", error.getMessage());
    }

    @Test
    void addGroupMemberOnlyAddsOnce() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("mockGroup");
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        keymaster.addGroupMember(groupDid, dataDid);
        keymaster.addGroupMember(groupDid, dataDid);
        keymaster.addGroupMember(groupDid, dataDid);
        boolean ok = keymaster.addGroupMember(groupDid, dataDid);

        assertTrue(ok);
        Group group = keymaster.getGroup(groupDid);
        assertNotNull(group);
        assertEquals(List.of(dataDid), group.members);
    }

    @Test
    void addGroupMemberDoesNotIncrementVersionWhenDuplicate() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("mockGroup");
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        keymaster.addGroupMember(groupDid, dataDid);
        MdipDocument doc1 = keymaster.resolveDID(groupDid);
        String version1 = doc1.didDocumentMetadata.version;

        keymaster.addGroupMember(groupDid, dataDid);
        MdipDocument doc2 = keymaster.resolveDID(groupDid);
        String version2 = doc2.didDocumentMetadata.version;

        assertEquals(version1, version2);
    }

    @Test
    void addGroupMemberAddsMultipleMembers() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("mockGroup");
        int memberCount = 5;

        for (int i = 0; i < memberCount; i += 1) {
            String dataDid = keymaster.createAsset(Map.of("name", "mock-" + i));
            keymaster.addGroupMember(groupDid, dataDid);
        }

        Group group = keymaster.getGroup(groupDid);
        assertNotNull(group);
        assertEquals(memberCount, group.members.size());
    }

    @Test
    void addGroupMemberRejectsInvalidMemberDid() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("mockGroup");

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.addGroupMember(groupDid, "did:mock")
        );

        assertEquals("Invalid parameter: memberId", error.getMessage());
    }

    @Test
    void addGroupMemberRejectsNonGroup() {
        Keymaster keymaster = newKeymaster();
        String agentDid = keymaster.createId("Bob");
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        IllegalArgumentException error1 = assertThrows(IllegalArgumentException.class, () ->
            keymaster.addGroupMember(agentDid, dataDid)
        );
        assertEquals("Invalid parameter: groupId", error1.getMessage());

        IllegalArgumentException error2 = assertThrows(IllegalArgumentException.class, () ->
            keymaster.addGroupMember(dataDid, agentDid)
        );
        assertEquals("Invalid parameter: groupId", error2.getMessage());
    }

    @Test
    void addGroupMemberRejectsSelfMembership() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("group");

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.addGroupMember(groupDid, groupDid)
        );
        assertEquals("Invalid parameter: can't add a group to itself", error.getMessage());
    }

    @Test
    void addGroupMemberRejectsMutualMembership() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String group1 = keymaster.createGroup("group-1");
        String group2 = keymaster.createGroup("group-2");
        String group3 = keymaster.createGroup("group-3");

        keymaster.addGroupMember(group1, group2);
        keymaster.addGroupMember(group2, group3);

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.addGroupMember(group3, group1)
        );
        assertEquals("Invalid parameter: can't create mutual membership", error.getMessage());
    }

    @Test
    void removeGroupMemberRemovesDidMember() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupName = "mockGroup";
        String groupDid = keymaster.createGroup(groupName);
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));
        keymaster.addGroupMember(groupDid, dataDid);

        boolean ok = keymaster.removeGroupMember(groupDid, dataDid);

        assertTrue(ok);
        Group group = keymaster.getGroup(groupDid);
        assertNotNull(group);
        assertEquals(groupName, group.name);
        assertEquals(List.of(), group.members);
    }

    @Test
    void removeGroupMemberRemovesAliasMember() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupName = "mockGroup";
        String groupDid = keymaster.createGroup(groupName);
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));
        keymaster.addGroupMember(groupDid, dataDid);

        String alias = "mockAlias";
        keymaster.addName(alias, dataDid);
        boolean ok = keymaster.removeGroupMember(groupDid, alias);

        assertTrue(ok);
        Group group = keymaster.getGroup(groupDid);
        assertNotNull(group);
        assertEquals(List.of(), group.members);
    }

    @Test
    void removeGroupMemberOkWhenNotMember() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupName = "mockGroup";
        String groupDid = keymaster.createGroup(groupName);
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        boolean ok = keymaster.removeGroupMember(groupDid, dataDid);

        assertTrue(ok);
        Group group = keymaster.getGroup(groupDid);
        assertNotNull(group);
        assertEquals(List.of(), group.members);
    }

    @Test
    void removeGroupMemberDoesNotIncrementVersionWhenMissing() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("mockGroup");

        MdipDocument doc1 = keymaster.resolveDID(groupDid);
        String version1 = doc1.didDocumentMetadata.version;

        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));
        keymaster.removeGroupMember(groupDid, dataDid);

        MdipDocument doc2 = keymaster.resolveDID(groupDid);
        String version2 = doc2.didDocumentMetadata.version;

        assertEquals(version1, version2);
    }

    @Test
    void removeGroupMemberRejectsInvalidMemberDid() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("mockGroup");

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.removeGroupMember(groupDid, "did:mock")
        );
        assertEquals("Invalid parameter: memberId", error.getMessage());
    }

    @Test
    void removeGroupMemberRejectsNonGroup() {
        Keymaster keymaster = newKeymaster();
        String agentDid = keymaster.createId("Bob");
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        IllegalArgumentException error1 = assertThrows(IllegalArgumentException.class, () ->
            keymaster.removeGroupMember(agentDid, dataDid)
        );
        assertEquals("Invalid parameter: groupId", error1.getMessage());

        IllegalArgumentException error2 = assertThrows(IllegalArgumentException.class, () ->
            keymaster.removeGroupMember(dataDid, agentDid)
        );
        assertEquals("Invalid parameter: groupId", error2.getMessage());
    }

    @Test
    void testGroupReturnsTrueWhenMemberPresent() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("mockGroup");
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));
        keymaster.addGroupMember(groupDid, dataDid);

        boolean test = keymaster.testGroup(groupDid, dataDid);

        assertTrue(test);
    }

    @Test
    void testGroupReturnsFalseWhenMemberAbsent() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("mockGroup");
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        boolean test = keymaster.testGroup(groupDid, dataDid);

        assertFalse(test);
    }

    @Test
    void testGroupReturnsTrueWhenGroupOnly() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String groupDid = keymaster.createGroup("mockGroup");

        boolean test = keymaster.testGroup(groupDid);

        assertTrue(test);
    }

    @Test
    void testGroupReturnsFalseWhenNonGroupOnly() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String dataDid = keymaster.createAsset(Map.of("name", "mockData"));

        boolean test = keymaster.testGroup(dataDid);

        assertFalse(test);
    }

    @Test
    void testGroupReturnsTrueForRecursiveMembers() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String group1 = keymaster.createGroup("level-1");
        String group2 = keymaster.createGroup("level-2");
        String group3 = keymaster.createGroup("level-3");
        String group4 = keymaster.createGroup("level-4");
        String group5 = keymaster.createGroup("level-5");

        keymaster.addGroupMember(group1, group2);
        keymaster.addGroupMember(group2, group3);
        keymaster.addGroupMember(group3, group4);
        keymaster.addGroupMember(group4, group5);

        assertTrue(keymaster.testGroup(group1, group2));
        assertTrue(keymaster.testGroup(group1, group3));
        assertTrue(keymaster.testGroup(group1, group4));
        assertTrue(keymaster.testGroup(group1, group5));
    }

    @Test
    void listGroupsReturnsGroupsOnly() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        String group1 = keymaster.createGroup("mock-1");
        String group2 = keymaster.createGroup("mock-2");
        String group3 = keymaster.createGroup("mock-3");
        String schema1 = keymaster.createSchema();
        keymaster.addToOwned("did:test:mock53", null);

        List<String> groups = keymaster.listGroups();

        assertTrue(groups.contains(group1));
        assertTrue(groups.contains(group2));
        assertTrue(groups.contains(group3));
        assertFalse(groups.contains(schema1));
    }
}
