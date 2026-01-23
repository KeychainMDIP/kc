package org.keychain.demo.ui;

import com.vaadin.flow.component.Text;
import com.vaadin.flow.component.Key;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.combobox.ComboBox;
import com.vaadin.flow.component.confirmdialog.ConfirmDialog;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H2;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.notification.Notification;
import com.vaadin.flow.component.notification.NotificationVariant;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;
import com.vaadin.flow.component.tabs.Tab;
import com.vaadin.flow.component.tabs.Tabs;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.data.value.ValueChangeMode;
import com.vaadin.flow.component.upload.Upload;
import com.vaadin.flow.component.upload.UploadI18N;
import com.vaadin.flow.component.upload.receivers.MemoryBuffer;
import com.vaadin.flow.component.textfield.PasswordField;
import com.vaadin.flow.component.textfield.TextArea;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.server.StreamResource;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.keychain.demo.config.KeymasterConfig;
import org.keychain.demo.service.KeymasterService;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.model.CheckWalletResult;
import org.keychain.keymaster.model.FixWalletResult;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;

@Route("")
public class MainView extends VerticalLayout {
    private static final String DEFAULT_SCHEMA_JSON = String.join("\n",
        "{",
        "  \"$schema\": \"http://json-schema.org/draft-07/schema#\",",
        "  \"type\": \"object\",",
        "  \"properties\": {",
        "    \"propertyName\": {",
        "      \"type\": \"string\"",
        "    }",
        "  },",
        "  \"required\": [",
        "    \"propertyName\"",
        "  ]",
        "}"
    );
    private final KeymasterService keymasterService;
    private final GatekeeperInterface gatekeeper;
    private final KeymasterConfig config;

    private final Span currentAliasValue = new Span("-");
    private final Span currentDidValue = new Span("-");
    private final ComboBox<String> currentIdSelect = new ComboBox<>();
    private final TextArea docsArea = new TextArea();
    private final Div identitySelectorPanel = new Div();
    private final Div identityDocsPanel = new Div();
    private final HorizontalLayout identityActionsRow = new HorizontalLayout();
    private final Div identityCreatePanel = new Div();
    private final TextField createInlineNameField = new TextField("Name");
    private final ComboBox<String> createInlineRegistrySelect = new ComboBox<>("Registry");
    private final Button createInlineButton = new Button("CREATE");
    private final Button cancelInlineButton = new Button("CANCEL");
    private final Button createIdButton = new Button("CREATE");
    private final Button renameIdButton = new Button("RENAME");
    private final Button removeIdButton = new Button("REMOVE");
    private final Button backupIdButton = new Button("BACKUP");
    private final Button recoverIdButton = new Button("RECOVER");
    private final Button rotateKeysButton = new Button("ROTATE KEYS");
    private final ComboBox<String> schemaSelect = new ComboBox<>();
    private final Button schemaCopyButton = new Button(VaadinIcon.COPY.create());
    private final Button schemaCreateButton = new Button("CREATE");
    private final TextArea schemaArea = new TextArea();
    private final Dialog schemaCreateDialog = new Dialog();
    private final TextField schemaNameField = new TextField("Schema name");
    private final ComboBox<String> schemaRegistrySelect = new ComboBox<>("Registry");
    private final TextArea schemaCreateArea = new TextArea("Schema JSON");
    private boolean schemaOwned = false;
    private String selectedSchemaDid = null;
    private final VerticalLayout schemaDetails = new VerticalLayout();
    private final TextField groupNameField = new TextField("Group name");
    private final ComboBox<String> groupRegistrySelect = new ComboBox<>("Registry");
    private final ComboBox<String> groupSelect = new ComboBox<>();
    private final Button groupCopyButton = new Button(VaadinIcon.COPY.create());
    private final Button groupCreateButton = new Button("CREATE");
    private final TextArea groupArea = new TextArea();
    private final VerticalLayout groupDetails = new VerticalLayout();
    private final TextField groupMemberField = new TextField("Member DID");
    private final Button groupAddButton = new Button("ADD");
    private final Button groupRemoveButton = new Button("REMOVE");
    private final Button groupTestButton = new Button("TEST");
    private final HorizontalLayout groupMemberButtonsRow = new HorizontalLayout();
    private final Div groupActionResultWrap = new Div();
    private final ComboBox<String> groupMemberSelect = new ComboBox<>();
    private final Span groupActionResult = new Span();
    private String selectedGroupDid = null;
    private java.util.List<String> agentNames = new java.util.ArrayList<>();
    private java.util.List<String> schemaNames = new java.util.ArrayList<>();
    private java.util.List<String> groupNames = new java.util.ArrayList<>();
    private final TextField authChallengeField = new TextField();
    private final TextField authResponseField = new TextField();
    private final Span authDidValue = new Span();
    private final TextArea authStringArea = new TextArea();
    private final Dialog authChallengeDialog = new Dialog();
    private final TextArea authChallengeJsonArea = new TextArea();
    private final Button authNewButton = new Button("NEW");
    private final Button authResolveButton = new Button("RESOLVE");
    private final Button authRespondButton = new Button("RESPOND");
    private final Button authClearChallengeButton = new Button("CLEAR");
    private final Button authDecryptButton = new Button("DECRYPT");
    private final Button authVerifyButton = new Button("VERIFY");
    private final Button authSendButton = new Button("SEND");
    private final Button authClearResponseButton = new Button("CLEAR");
    private boolean disableSendResponse = true;
    private String callbackUrl = null;
    private final TextField didNameField = new TextField("Name");
    private final TextField didValueField = new TextField("DID");
    private final ComboBox<String> didSelect = new ComboBox<>();
    private final TextArea didDocsArea = new TextArea();
    private java.util.Map<String, String> didNameMap = new java.util.HashMap<>();
    private java.util.Map<String, String> didToName = new java.util.HashMap<>();
    private java.util.Map<String, Object> manifest = new java.util.HashMap<>();
    private final Button didResolveButton = new Button("RESOLVE");
    private final Button didAddButton = new Button("ADD");
    private final Button didResolveSelectedButton = new Button("RESOLVE");
    private final Button didRemoveButton = new Button("REMOVE");
    private final Button didCopyButton = new Button(VaadinIcon.COPY.create());
    private final ComboBox<String> heldSelect = new ComboBox<>();
    private final TextArea heldArea = new TextArea();
    private String selectedHeldDid = null;
    private final TextField heldDidField = new TextField("Credential DID");
    private final Button heldResolveFieldButton = new Button("RESOLVE");
    private final Button heldDecryptFieldButton = new Button("DECRYPT");
    private final Button heldAcceptFieldButton = new Button("ACCEPT");
    private final Button heldResolveSelectedButton = new Button("RESOLVE");
    private final Button heldDecryptSelectedButton = new Button("DECRYPT");
    private final Button heldCopyButton = new Button(VaadinIcon.COPY.create());
    private final Button heldRemoveButton = new Button("REMOVE");
    private final Button heldPublishButton = new Button("PUBLISH");
    private final Button heldRevealButton = new Button("REVEAL");
    private final Button heldUnpublishButton = new Button("UNPUBLISH");
    private final ComboBox<String> issuedSelect = new ComboBox<>();
    private final Button issuedCopyButton = new Button(VaadinIcon.COPY.create());
    private final TextArea issuedArea = new TextArea();
    private String selectedIssuedDid = null;
    private String issuedOriginal = "";
    private boolean issuedEditable = false;
    private final ComboBox<String> issueSubjectSelect = new ComboBox<>();
    private final ComboBox<String> issueSchemaSelect = new ComboBox<>();
    private final ComboBox<String> issueRegistrySelect = new ComboBox<>();
    private final TextArea issueArea = new TextArea();
    private final Span issueResult = new Span();
    private final Button issueEditButton = new Button("EDIT");
    private final Button issueButton = new Button("ISSUE");

    private final Dialog createDialog = new Dialog();
    private final TextField createNameField = new TextField("Name");
    private final ComboBox<String> createRegistrySelect = new ComboBox<>("Registry");
    private final Dialog renameDialog = new Dialog();
    private final TextField renameField = new TextField("New name");
    private final Dialog recoverDialog = new Dialog();
    private final TextField recoverField = new TextField("DID");
    private final ConfirmDialog removeConfirm = new ConfirmDialog();
    private final ConfirmDialog newWalletConfirm = new ConfirmDialog();
    private final ConfirmDialog recoverWalletConfirm = new ConfirmDialog();
    private final ConfirmDialog fixWalletConfirm = new ConfirmDialog();
    private final Dialog importDialog = new Dialog();
    private final TextArea importMnemonic = new TextArea("Mnemonic");
    private final Dialog mnemonicDialog = new Dialog();
    private final TextArea mnemonicArea = new TextArea("Mnemonic");
    private final Dialog walletDialog = new Dialog();
    private final TextArea walletArea = new TextArea("Wallet");
    private final Dialog passphraseDialog = new Dialog();
    private final PasswordField passphraseField = new PasswordField("Passphrase");
    private final PasswordField passphraseConfirmField = new PasswordField("Confirm passphrase");
    private final Span passphraseHint = new Span();
    private final Span passphraseError = new Span();
    private final Button passphraseSubmit = new Button();
    private final Button passphraseCancel = new Button("Cancel");
    private boolean passphraseCreateMode = false;
    private boolean passphraseResetMode = false;
    private Anchor downloadAnchor;
    private final Button checkWalletButton = new Button("CHECK");
    private final MemoryBuffer uploadBuffer = new MemoryBuffer();
    private final Upload upload = new Upload(uploadBuffer);
    private WalletEncFile pendingWallet = null;
    private boolean refreshing = false;
    private String currentIdName = null;
    private boolean ready = false;
    private boolean hasCurrentId = false;
    private final Tabs tabs = new Tabs();
    private final Tab identitiesTab = new Tab(VaadinIcon.USER.create(), new Span("IDENTITIES"));
    private final Tab didsTab = new Tab(VaadinIcon.LIST.create(), new Span("DIDS"));
    private final Tab schemasTab = new Tab(VaadinIcon.CLIPBOARD_TEXT.create(), new Span("SCHEMAS"));
    private final Tab groupsTab = new Tab(VaadinIcon.GROUP.create(), new Span("GROUPS"));
    private final Tab credentialsTab = new Tab(VaadinIcon.DIPLOMA.create(), new Span("CREDENTIALS"));
    private final Tab authTab = new Tab(VaadinIcon.KEY.create(), new Span("AUTH"));
    private final Tab walletTab = new Tab(VaadinIcon.WALLET.create(), new Span("WALLET"));
    private final VerticalLayout identityContent = new VerticalLayout();
    private final VerticalLayout didsContent = new VerticalLayout();
    private final VerticalLayout schemasContent = new VerticalLayout();
    private final VerticalLayout groupsContent = new VerticalLayout();
    private final VerticalLayout credentialsContent = new VerticalLayout();
    private final VerticalLayout authContent = new VerticalLayout();
    private final Tabs credentialTabs = new Tabs();
    private final Tab heldTab = new Tab("HELD");
    private final Tab issueTab = new Tab("ISSUE");
    private final Tab issuedTab = new Tab("ISSUED");
    private final VerticalLayout heldContent = new VerticalLayout();
    private final VerticalLayout issueContent = new VerticalLayout();
    private final VerticalLayout issuedContent = new VerticalLayout();
    private final VerticalLayout walletContent = new VerticalLayout();

    public MainView(KeymasterService keymasterService, GatekeeperInterface gatekeeper, KeymasterConfig config) {
        this.keymasterService = keymasterService;
        this.gatekeeper = gatekeeper;
        this.config = config;

        setSpacing(true);
        setPadding(true);
        setSizeFull();
        setMaxWidth("980px");

        currentAliasValue.getStyle().set("font-weight", "600");

        add(header());
        add(idLine());
        add(tabsRow());
        add(contentPanel());

        configureCreateDialog();
        configureRenameDialog();
        configureRecoverDialog();
        configureRemoveConfirm();
        configureNewWalletConfirm();
        configureRecoverWalletConfirm();
        configureFixWalletConfirm();
        configureImportDialog();
        configureMnemonicDialog();
        configureWalletDialog();
        configureSchemaCreateDialog();
        configurePassphraseDialog();
        configureAuthChallengeDialog();
        setReady(false);
        openPassphraseDialog();
        refresh();
    }

    private Div header() {
        Div header = new Div();
        H2 title = new H2("Keymaster Browser Wallet Demo");
        title.getStyle()
                .set("margin-top", "0")
                .set("margin-bottom", "8px");
        header.add(title);
        return header;
    }

    private Div idLine() {
        Div line = new Div();
        currentAliasValue.getStyle().set("margin-left", "16px");
        currentDidValue.getStyle().set("margin-left", "16px");
        line.add(new Text("ID:"), currentAliasValue, currentDidValue);
        return line;
    }

    private Tabs tabsRow() {
        tabs.add(identitiesTab, didsTab, schemasTab, groupsTab, credentialsTab, authTab, walletTab);
        tabs.setSelectedTab(identitiesTab);
        tabs.addSelectedChangeListener(event -> updateTabVisibility());
        return tabs;
    }

    private VerticalLayout contentPanel() {
        identityContent.setPadding(false);
        identityContent.setSpacing(true);
        identityContent.add(identityCreatePanel(), identitySelector(), actionsRow(), docsPanel());

        didsContent.setPadding(false);
        didsContent.setSpacing(true);
        didsContent.setVisible(false);
        didsContent.add(didsActionsRow(), didsSelectorRow(), didsDocsPanel());

        schemasContent.setPadding(false);
        schemasContent.setSpacing(true);
        schemasContent.setVisible(false);
        schemasContent.add(schemaHeaderRow(), schemaDetailsPanel());

        schemaSelect.addValueChangeListener(event -> {
            if (refreshing) {
                return;
            }
            String value = event.getValue();
            if (value != null && !value.isBlank()) {
                selectSchema(value);
            }
            updateSchemaSelectionState();
        });

        groupsContent.setPadding(false);
        groupsContent.setSpacing(true);
        groupsContent.setVisible(false);
        groupsContent.add(groupHeaderRow(), groupDetailsPanel());

        groupSelect.addValueChangeListener(event -> {
            if (refreshing) {
                return;
            }
            String value = event.getValue();
            if (value != null && !value.isBlank()) {
                selectGroup(value);
            }
            updateGroupSelectionState();
        });

        credentialsContent.setPadding(false);
        credentialsContent.setSpacing(true);
        credentialsContent.setVisible(false);
        credentialsContent.add(credentialsTabsRow(), credentialsPanel());

        authContent.setPadding(false);
        authContent.setSpacing(true);
        authContent.setVisible(false);
        authContent.add(authPanel());

        walletContent.setPadding(false);
        walletContent.setSpacing(true);
        walletContent.setVisible(false);
        walletContent.add(walletActionsRow(), walletActionsRowTwo());

        VerticalLayout panel = new VerticalLayout(
            identityContent,
            didsContent,
            schemasContent,
            groupsContent,
            credentialsContent,
            authContent,
            walletContent
        );
        panel.setPadding(false);
        panel.setSpacing(true);
        return panel;
    }

    private Div identitySelector() {
        identitySelectorPanel.removeAll();
        currentIdSelect.setWidth("320px");
        currentIdSelect.setPlaceholder("Select identity");
        currentIdSelect.getElement().getStyle().set("--lumo-contrast-20pct", "#666");
        currentIdSelect.getElement().getStyle().set("--lumo-contrast-30pct", "#555");
        currentIdSelect.getElement().getStyle().set("border", "1px solid #666");
        currentIdSelect.getElement().getStyle().set("border-radius", "6px");
        currentIdSelect.addValueChangeListener(event -> {
            if (refreshing) {
                return;
            }
            String value = event.getValue();
            if (value != null && !value.isBlank()) {
                setCurrentId(value);
            }
        });
        identitySelectorPanel.add(currentIdSelect);
        return identitySelectorPanel;
    }

    private Div identityCreatePanel() {
        identityCreatePanel.removeAll();
        createInlineNameField.setWidth("320px");
        createInlineRegistrySelect.setWidth("220px");

        createInlineButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        cancelInlineButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        createInlineButton.addClickListener(event -> submitCreateInline());
        cancelInlineButton.addClickListener(event -> clearInlineCreate());

        HorizontalLayout fields = new HorizontalLayout(createInlineNameField, createInlineRegistrySelect);
        HorizontalLayout actions = new HorizontalLayout(createInlineButton, cancelInlineButton);
        identityCreatePanel.add(fields, actions);
        return identityCreatePanel;
    }

    private HorizontalLayout actionsRow() {
        identityActionsRow.removeAll();
        createIdButton.addClickListener(event -> openCreateDialog());
        renameIdButton.addClickListener(event -> openRenameDialog());
        removeIdButton.addClickListener(event -> confirmRemove());
        backupIdButton.addClickListener(event -> backupId());
        recoverIdButton.addClickListener(event -> openRecoverDialog());
        rotateKeysButton.addClickListener(event -> rotateKeys());

        createIdButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        renameIdButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        removeIdButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        backupIdButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        recoverIdButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        rotateKeysButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        identityActionsRow.add(
            createIdButton,
            renameIdButton,
            removeIdButton,
            backupIdButton,
            recoverIdButton,
            rotateKeysButton
        );
        identityActionsRow.setSpacing(true);
        return identityActionsRow;
    }

    private Div docsPanel() {
        identityDocsPanel.removeAll();
        docsArea.setWidth("800px");
        docsArea.setHeight("600px");
        docsArea.setReadOnly(true);
        identityDocsPanel.add(docsArea);
        return identityDocsPanel;
    }

    private HorizontalLayout didsActionsRow() {
        didNameField.setWidth("200px");
        didValueField.setWidth("420px");
        didResolveButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        didAddButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        didResolveButton.addClickListener(event -> resolveDidInput());
        didAddButton.addClickListener(event -> addDidName());
        didNameField.setValueChangeMode(ValueChangeMode.EAGER);
        didValueField.setValueChangeMode(ValueChangeMode.EAGER);
        didNameField.addValueChangeListener(event -> updateDidActionsState());
        didValueField.addValueChangeListener(event -> updateDidActionsState());
        updateDidActionsState();

        HorizontalLayout row = new HorizontalLayout(didNameField, didValueField, didResolveButton, didAddButton);
        row.setSpacing(true);
        row.setAlignItems(Alignment.END);
        return row;
    }

    private HorizontalLayout didsSelectorRow() {
        didSelect.setWidth("520px");
        didSelect.setPlaceholder("Select named DID");
        didSelect.addValueChangeListener(event -> {
            if (refreshing) {
                return;
            }
            updateDidSelectionState();
        });
        wireCopyButton(didCopyButton, this::copySelectedDid);
        didResolveSelectedButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        didRemoveButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        didResolveSelectedButton.addClickListener(event -> resolveSelectedName());
        didRemoveButton.addClickListener(event -> removeSelectedName());
        updateDidSelectionState();

        HorizontalLayout row = new HorizontalLayout(didSelect, didCopyButton, didResolveSelectedButton, didRemoveButton);
        row.setSpacing(true);
        row.setAlignItems(Alignment.END);
        return row;
    }

    private Div didsDocsPanel() {
        Div panel = new Div();
        didDocsArea.setWidth("800px");
        didDocsArea.setHeight("600px");
        didDocsArea.setReadOnly(true);
        panel.add(didDocsArea);
        return panel;
    }

    private HorizontalLayout schemaActionsRow() {
        Button test = new Button("TEST", event -> testSchema());
        Button save = new Button("SAVE", event -> saveSchema());

        test.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        save.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        HorizontalLayout row = new HorizontalLayout(test, save);
        row.setSpacing(true);
        return row;
    }

    private Div schemaSelector() {
        Div panel = new Div();
        schemaSelect.setWidth("520px");
        schemaSelect.setPlaceholder("Select schema");
        schemaSelect.addValueChangeListener(event -> {
            if (refreshing) {
                return;
            }
            String value = event.getValue();
            if (value != null && !value.isBlank()) {
                selectSchema(value);
            }
        });
        panel.add(schemaSelect);
        return panel;
    }

    private Div schemaViewer() {
        Div panel = new Div();
        schemaArea.setWidth("800px");
        schemaArea.setHeight("420px");
        schemaArea.setReadOnly(true);
        panel.add(schemaArea);
        return panel;
    }

    private HorizontalLayout schemaHeaderRow() {
        schemaNameField.setWidth("320px");
        schemaRegistrySelect.setWidth("220px");
        schemaSelect.setWidth("320px");
        schemaSelect.setPlaceholder("Select schema");

        schemaCreateButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        schemaCreateButton.addClickListener(event -> openSchemaCreateDialog());
        schemaCreateButton.setEnabled(false);
        schemaNameField.setValueChangeMode(ValueChangeMode.EAGER);
        schemaNameField.addValueChangeListener(event -> updateSchemaCreateState());

        HorizontalLayout top = new HorizontalLayout(schemaNameField, schemaCreateButton, schemaRegistrySelect);
        top.setSpacing(true);
        top.setAlignItems(Alignment.END);

        wireCopyButton(schemaCopyButton, this::copySchemaDid);
        HorizontalLayout bottom = new HorizontalLayout(schemaSelect, schemaCopyButton);
        bottom.setSpacing(true);

        VerticalLayout panel = new VerticalLayout(top, bottom);
        panel.setPadding(false);
        panel.setSpacing(true);
        HorizontalLayout row = new HorizontalLayout(panel);
        row.setPadding(false);
        return row;
    }

    private VerticalLayout schemaDetailsPanel() {
        schemaDetails.removeAll();
        schemaDetails.setPadding(false);
        schemaDetails.setSpacing(true);
        schemaDetails.setVisible(false);
        schemaDetails.add(schemaActionsRow(), schemaViewer());
        return schemaDetails;
    }

    private HorizontalLayout groupHeaderRow() {
        groupNameField.setWidth("320px");
        groupRegistrySelect.setWidth("220px");
        groupSelect.setWidth("320px");
        groupSelect.setPlaceholder("Select group");

        groupCreateButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        groupCreateButton.addClickListener(event -> createGroup());
        groupCreateButton.setEnabled(false);
        groupNameField.setValueChangeMode(ValueChangeMode.EAGER);
        groupNameField.addValueChangeListener(event -> updateGroupCreateState());

        HorizontalLayout top = new HorizontalLayout(groupNameField, groupCreateButton, groupRegistrySelect);
        top.setSpacing(true);
        top.setAlignItems(Alignment.END);

        wireCopyButton(groupCopyButton, this::copyGroupDid);
        HorizontalLayout bottom = new HorizontalLayout(groupSelect, groupCopyButton);
        bottom.setSpacing(true);

        VerticalLayout panel = new VerticalLayout(top, bottom);
        panel.setPadding(false);
        panel.setSpacing(true);
        HorizontalLayout row = new HorizontalLayout(panel);
        row.setPadding(false);
        return row;
    }

    private VerticalLayout groupDetailsPanel() {
        groupArea.setWidth("800px");
        groupArea.setHeight("420px");
        groupArea.setReadOnly(true);

        groupDetails.removeAll();
        groupDetails.setPadding(false);
        groupDetails.setSpacing(true);
        groupDetails.setVisible(false);
        groupDetails.add(groupMemberActionsRow(), groupArea);
        return groupDetails;
    }

    private VerticalLayout groupMemberActionsRow() {
        groupMemberField.setWidth("520px");
        groupMemberSelect.setWidth("520px");
        groupMemberSelect.setPlaceholder("Select member");
        groupMemberField.setValueChangeMode(ValueChangeMode.EAGER);
        groupMemberField.addValueChangeListener(event -> updateGroupMemberActionState());
        groupMemberSelect.addValueChangeListener(event -> updateGroupMemberActionState());

        groupAddButton.addClickListener(event -> addGroupMember());
        groupRemoveButton.addClickListener(event -> removeGroupMember());
        groupTestButton.addClickListener(event -> testGroupMember());

        groupAddButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        groupRemoveButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        groupTestButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        groupActionResultWrap.removeAll();
        groupActionResultWrap.add(groupActionResult);
        groupActionResultWrap.getStyle().set("display", "flex");
        groupActionResultWrap.getStyle().set("align-items", "center");
        groupActionResultWrap.setHeight("var(--lumo-size-m)");

        HorizontalLayout addTestRow = new HorizontalLayout(groupMemberField, groupAddButton, groupTestButton, groupActionResultWrap);
        addTestRow.setSpacing(true);
        addTestRow.setAlignItems(Alignment.END);

        groupMemberButtonsRow.removeAll();
        groupMemberButtonsRow.add(groupMemberSelect, groupRemoveButton);
        groupMemberButtonsRow.setSpacing(true);
        groupMemberButtonsRow.setAlignItems(Alignment.END);

        VerticalLayout panel = new VerticalLayout(addTestRow, groupMemberButtonsRow);
        panel.setPadding(false);
        panel.setSpacing(true);
        return panel;
    }

    private Tabs credentialsTabsRow() {
        credentialTabs.add(heldTab, issueTab, issuedTab);
        credentialTabs.setSelectedTab(heldTab);
        credentialTabs.addSelectedChangeListener(event -> updateCredentialTabVisibility());
        return credentialTabs;
    }

    private VerticalLayout credentialsPanel() {
        heldContent.setPadding(false);
        heldContent.setSpacing(true);
        heldContent.add(heldActionsRow(), heldSelector(), heldViewer());

        issueContent.setPadding(false);
        issueContent.setSpacing(true);
        issueContent.setVisible(false);
        issueContent.add(issueSelectorsRow(), issueEditor(), issueActionsRow());

        issuedContent.setPadding(false);
        issuedContent.setSpacing(true);
        issuedContent.setVisible(false);
        issuedContent.add(issuedSelector(), issuedActionsRow(), issuedViewer());

        VerticalLayout panel = new VerticalLayout(heldContent, issueContent, issuedContent);
        panel.setPadding(false);
        panel.setSpacing(true);
        return panel;
    }

    private VerticalLayout authPanel() {
        authChallengeField.setWidth("540px");
        authResponseField.setWidth("540px");
        authChallengeField.getStyle().set("font-family", "monospace");
        authResponseField.getStyle().set("font-family", "monospace");
        authChallengeField.getStyle().set("font-size", "0.8em");
        authResponseField.getStyle().set("font-size", "0.8em");
        authChallengeField.setValueChangeMode(ValueChangeMode.EAGER);
        authResponseField.setValueChangeMode(ValueChangeMode.EAGER);

        authStringArea.setWidth("800px");
        authStringArea.setHeight("600px");
        authStringArea.setReadOnly(true);

        authNewButton.addClickListener(event -> openAuthChallengeDialog());
        authResolveButton.addClickListener(event -> resolveChallenge(authChallengeField.getValue()));
        authRespondButton.addClickListener(event -> createResponse());
        authClearChallengeButton.addClickListener(event -> clearChallenge());

        authNewButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        authResolveButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        authRespondButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        authClearChallengeButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        HorizontalLayout challengeActions = new HorizontalLayout(
            authNewButton,
            authResolveButton,
            authRespondButton,
            authClearChallengeButton
        );
        challengeActions.setSpacing(true);

        VerticalLayout challengeBox = new VerticalLayout(authChallengeField, challengeActions);
        challengeBox.setPadding(false);
        challengeBox.setSpacing(true);

        authDecryptButton.addClickListener(event -> decryptResponse(authResponseField.getValue()));
        authVerifyButton.addClickListener(event -> verifyResponse());
        authSendButton.addClickListener(event -> sendResponse());
        authClearResponseButton.addClickListener(event -> clearResponse());

        authDecryptButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        authVerifyButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        authSendButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        authClearResponseButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        HorizontalLayout responseActions = new HorizontalLayout(
            authDecryptButton,
            authVerifyButton,
            authSendButton,
            authClearResponseButton
        );
        responseActions.setSpacing(true);

        VerticalLayout responseBox = new VerticalLayout(authResponseField, responseActions);
        responseBox.setPadding(false);
        responseBox.setSpacing(true);

        HorizontalLayout challengeRow = new HorizontalLayout(new Span("Challenge"), challengeBox);
        challengeRow.setWidthFull();
        challengeRow.setAlignItems(Alignment.START);
        challengeRow.getStyle().set("gap", "24px");

        HorizontalLayout responseRow = new HorizontalLayout(new Span("Response"), responseBox);
        responseRow.setWidthFull();
        responseRow.setAlignItems(Alignment.START);
        responseRow.getStyle().set("gap", "24px");

        authChallengeField.addValueChangeListener(event -> updateAuthButtons());
        authResponseField.addValueChangeListener(event -> updateAuthButtons());

        VerticalLayout panel = new VerticalLayout(
            challengeRow,
            responseRow,
            authDidValue,
            authStringArea
        );
        panel.setPadding(false);
        panel.setSpacing(true);
        updateAuthButtons();
        return panel;
    }

    private HorizontalLayout heldActionsRow() {
        heldDidField.setWidth("520px");
        heldResolveFieldButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        heldDecryptFieldButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        heldAcceptFieldButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        heldResolveFieldButton.addClickListener(event -> resolveHeldInput());
        heldDecryptFieldButton.addClickListener(event -> decryptHeldInput());
        heldAcceptFieldButton.addClickListener(event -> acceptHeldInput());
        heldDidField.setValueChangeMode(ValueChangeMode.EAGER);
        heldDidField.addValueChangeListener(event -> updateHeldInputState());
        updateHeldInputState();

        HorizontalLayout row = new HorizontalLayout(
            heldDidField,
            heldResolveFieldButton,
            heldDecryptFieldButton,
            heldAcceptFieldButton
        );
        row.setSpacing(true);
        row.setAlignItems(Alignment.END);
        return row;
    }

    private Div heldSelector() {
        Div panel = new Div();
        heldSelect.setWidth("520px");
        heldSelect.setPlaceholder("Select held credential");
        heldSelect.addValueChangeListener(event -> {
            if (refreshing) {
                return;
            }
            String value = event.getValue();
            if (value != null && !value.isBlank()) {
                selectedHeldDid = value;
                heldArea.clear();
                updateHeldSelectionState();
            } else {
                selectedHeldDid = null;
                heldArea.clear();
                updateHeldSelectionState();
            }
        });
        heldResolveSelectedButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        heldDecryptSelectedButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        heldRemoveButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        heldPublishButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        heldRevealButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        heldUnpublishButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        heldResolveSelectedButton.addClickListener(event -> resolveHeldSelected());
        heldDecryptSelectedButton.addClickListener(event -> decryptHeldSelected());
        wireCopyButton(heldCopyButton, this::copyHeldDid);
        heldRemoveButton.addClickListener(event -> removeHeld());
        heldPublishButton.addClickListener(event -> publishHeld(false));
        heldRevealButton.addClickListener(event -> publishHeld(true));
        heldUnpublishButton.addClickListener(event -> unpublishHeld());

        HorizontalLayout selectRow = new HorizontalLayout(heldSelect, heldCopyButton);
        selectRow.setSpacing(true);

        HorizontalLayout actionsRow = new HorizontalLayout(
            heldResolveSelectedButton,
            heldDecryptSelectedButton,
            heldRemoveButton,
            heldPublishButton,
            heldRevealButton,
            heldUnpublishButton
        );
        actionsRow.setSpacing(true);
        actionsRow.setAlignItems(Alignment.END);
        panel.add(selectRow, actionsRow);
        return panel;
    }

    private Div heldViewer() {
        Div panel = new Div();
        heldArea.setWidth("800px");
        heldArea.setHeight("600px");
        heldArea.setReadOnly(true);
        panel.add(heldArea);
        return panel;
    }

    private HorizontalLayout issuedActionsRow() {
        Button resolve = new Button("RESOLVE", event -> resolveIssued());
        Button decrypt = new Button("DECRYPT", event -> decryptIssued());
        Button update = new Button("UPDATE", event -> updateIssued());
        Button revoke = new Button("REVOKE", event -> revokeIssued());

        resolve.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        decrypt.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        update.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        revoke.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        HorizontalLayout row = new HorizontalLayout(resolve, decrypt, update, revoke);
        row.setSpacing(true);
        return row;
    }

    private Div issuedSelector() {
        Div panel = new Div();
        issuedSelect.setWidth("520px");
        issuedSelect.setPlaceholder("Select issued credential");
        issuedSelect.addValueChangeListener(event -> {
            if (refreshing) {
                return;
            }
            String value = event.getValue();
            if (value != null && !value.isBlank()) {
                selectedIssuedDid = value;
            }
            updateIssuedSelectionState();
        });
        wireCopyButton(issuedCopyButton, this::copyIssuedDid);
        HorizontalLayout selectRow = new HorizontalLayout(issuedSelect, issuedCopyButton);
        selectRow.setSpacing(true);
        panel.add(selectRow);
        return panel;
    }

    private Div issuedViewer() {
        Div panel = new Div();
        issuedArea.setWidth("800px");
        issuedArea.setHeight("600px");
        issuedArea.setReadOnly(true);
        panel.add(issuedArea);
        return panel;
    }

    private HorizontalLayout issueSelectorsRow() {
        issueSubjectSelect.setWidth("280px");
        issueSubjectSelect.setPlaceholder("Select subject");
        issueSchemaSelect.setWidth("280px");
        issueSchemaSelect.setPlaceholder("Select schema");

        issueSubjectSelect.addValueChangeListener(event -> updateIssueButtons());
        issueSchemaSelect.addValueChangeListener(event -> updateIssueButtons());

        issueEditButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        issueEditButton.addClickListener(event -> editCredential());
        issueEditButton.setEnabled(false);

        HorizontalLayout row = new HorizontalLayout(issueSubjectSelect, issueSchemaSelect, issueEditButton);
        row.setSpacing(true);
        return row;
    }

    private Div issueEditor() {
        Div panel = new Div();
        issueArea.setWidth("800px");
        issueArea.setHeight("600px");
        issueArea.setValueChangeMode(ValueChangeMode.EAGER);
        issueArea.addValueChangeListener(event -> updateIssueButtons());
        panel.add(issueArea);
        return panel;
    }

    private HorizontalLayout issueActionsRow() {
        issueButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        issueButton.addClickListener(event -> issueCredential());
        issueButton.setEnabled(false);

        issueRegistrySelect.setWidth("220px");
        HorizontalLayout row = new HorizontalLayout(issueButton, issueRegistrySelect, issueResult);
        row.setSpacing(true);
        return row;
    }

    private HorizontalLayout walletActionsRow() {
        Button newWallet = new Button("NEW", event -> confirmNewWallet());
        Button importWallet = new Button("IMPORT", event -> openImportDialog());
        Button backupWallet = new Button("BACKUP", event -> backupWallet());
        Button recoverWallet = new Button("RECOVER", event -> confirmRecoverWallet());
        checkWalletButton.addClickListener(event -> checkWallet());

        newWallet.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        importWallet.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        backupWallet.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        recoverWallet.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        checkWalletButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        HorizontalLayout row = new HorizontalLayout(newWallet, importWallet, backupWallet, recoverWallet, checkWalletButton);
        row.setSpacing(true);
        return row;
    }

    private HorizontalLayout walletActionsRowTwo() {
        Button showMnemonic = new Button("SHOW MNEMONIC", event -> showMnemonic());
        Button showWallet = new Button("SHOW WALLET", event -> showWallet());
        Button downloadButton = new Button("DOWNLOAD", event -> prepareWalletDownload());
        Button uploadButton = new Button("UPLOAD");

        showMnemonic.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        showWallet.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        downloadButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        uploadButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        downloadAnchor = new Anchor();
        downloadAnchor.getElement().setAttribute("download", true);
        downloadAnchor.getStyle().set("text-decoration", "none");
        downloadAnchor.add(downloadButton);

        upload.setAcceptedFileTypes("application/json");
        upload.setMaxFiles(1);
        upload.setAutoUpload(true);
        upload.setDropAllowed(false);
        upload.setUploadButton(uploadButton);
        upload.getElement().getStyle().set("border", "0");
        upload.getElement().getStyle().set("padding", "0");
        upload.getElement().getStyle().set("display", "inline-flex");
        upload.getElement().getStyle().set("align-items", "center");
        UploadI18N i18n = new UploadI18N();
        i18n.setDropFiles(new UploadI18N.DropFiles().setOne("").setMany(""));
        i18n.setAddFiles(new UploadI18N.AddFiles().setOne("Upload").setMany("Upload"));
        upload.setI18n(i18n);
        upload.addSucceededListener(event -> handleWalletUpload());

        HorizontalLayout row = new HorizontalLayout(showMnemonic, showWallet, downloadAnchor, upload);
        row.setSpacing(true);
        return row;
    }

    private void configureCreateDialog() {
        createDialog.setHeaderTitle("Create ID");
        createDialog.setCloseOnOutsideClick(false);
        createDialog.setCloseOnEsc(true);

        createNameField.setWidth("280px");
        createRegistrySelect.setWidth("220px");

        Button create = new Button("Create", event -> submitCreate());
        create.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        Button cancel = new Button("Cancel", event -> createDialog.close());

        HorizontalLayout fields = new HorizontalLayout(createNameField, createRegistrySelect);
        HorizontalLayout actions = new HorizontalLayout(create, cancel);

        createDialog.add(fields, actions);
        add(createDialog);
    }

    private void configureRenameDialog() {
        renameDialog.setHeaderTitle("Rename ID");
        renameDialog.setCloseOnOutsideClick(false);
        renameDialog.setCloseOnEsc(true);
        renameField.setWidth("320px");

        Button rename = new Button("Rename", event -> submitRename());
        rename.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        Button cancel = new Button("Cancel", event -> renameDialog.close());

        HorizontalLayout actions = new HorizontalLayout(rename, cancel);
        renameDialog.add(renameField, actions);
        add(renameDialog);
    }

    private void configureRecoverDialog() {
        recoverDialog.setHeaderTitle("Recover ID");
        recoverDialog.setCloseOnOutsideClick(false);
        recoverDialog.setCloseOnEsc(true);
        recoverField.setWidth("360px");

        Button recover = new Button("Recover", event -> submitRecover());
        recover.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        Button cancel = new Button("Cancel", event -> recoverDialog.close());

        HorizontalLayout actions = new HorizontalLayout(recover, cancel);
        recoverDialog.add(recoverField, actions);
        add(recoverDialog);
    }

    private void configureRemoveConfirm() {
        removeConfirm.setHeader("Remove ID");
        removeConfirm.setConfirmText("Remove");
        removeConfirm.setCancelText("Cancel");
        removeConfirm.setCancelable(true);
        removeConfirm.addConfirmListener(event -> removeSelectedId());
        add(removeConfirm);
    }

    private void configureNewWalletConfirm() {
        newWalletConfirm.setHeader("New Wallet");
        newWalletConfirm.setText("Overwrite wallet with new one?");
        newWalletConfirm.setConfirmText("Overwrite");
        newWalletConfirm.setCancelText("Cancel");
        newWalletConfirm.addConfirmListener(event -> {
            setReady(false);
            openPassphraseDialog(true, true);
        });
        add(newWalletConfirm);
    }

    private void configureRecoverWalletConfirm() {
        recoverWalletConfirm.setHeader("Recover Wallet");
        recoverWalletConfirm.setText("Overwrite wallet from backup?");
        recoverWalletConfirm.setConfirmText("Recover");
        recoverWalletConfirm.setCancelText("Cancel");
        recoverWalletConfirm.setCancelable(true);
        recoverWalletConfirm.addConfirmListener(event -> recoverWallet());
        add(recoverWalletConfirm);
    }

    private void configureFixWalletConfirm() {
        fixWalletConfirm.setHeader("Fix Wallet");
        fixWalletConfirm.setConfirmText("Fix");
        fixWalletConfirm.setCancelText("Cancel");
        fixWalletConfirm.addConfirmListener(event -> fixWallet());
        add(fixWalletConfirm);
    }

    private void configureImportDialog() {
        importDialog.setHeaderTitle("Import Wallet");
        importDialog.setCloseOnOutsideClick(false);
        importDialog.setCloseOnEsc(true);
        importMnemonic.setWidth("520px");
        importMnemonic.setHeight("120px");

        Button importButton = new Button("Import", event -> submitImport());
        importButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        Button cancel = new Button("Cancel", event -> importDialog.close());

        HorizontalLayout actions = new HorizontalLayout(importButton, cancel);
        importDialog.add(importMnemonic, actions);
        add(importDialog);
    }

    private void configureMnemonicDialog() {
        mnemonicDialog.setHeaderTitle("Mnemonic");
        mnemonicDialog.setCloseOnOutsideClick(true);
        mnemonicDialog.setCloseOnEsc(true);
        mnemonicArea.setWidth("520px");
        mnemonicArea.setHeight("120px");
        mnemonicArea.setReadOnly(true);

        Button close = new Button("Close", event -> mnemonicDialog.close());
        mnemonicDialog.add(mnemonicArea, close);
        add(mnemonicDialog);
    }

    private void configureWalletDialog() {
        walletDialog.setHeaderTitle("Wallet");
        walletDialog.setCloseOnOutsideClick(true);
        walletDialog.setCloseOnEsc(true);
        walletArea.setWidth("720px");
        walletArea.setHeight("420px");
        walletArea.setReadOnly(true);

        Button close = new Button("Close", event -> walletDialog.close());
        walletDialog.add(walletArea, close);
        add(walletDialog);
    }

    private void configureSchemaCreateDialog() {
        schemaCreateDialog.setHeaderTitle("Create Schema");
        schemaCreateDialog.setCloseOnOutsideClick(false);
        schemaCreateDialog.setCloseOnEsc(true);
        schemaCreateArea.setWidth("720px");
        schemaCreateArea.setHeight("320px");

        Button create = new Button("Create", event -> submitSchemaCreate());
        create.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        Button cancel = new Button("Cancel", event -> schemaCreateDialog.close());

        HorizontalLayout actions = new HorizontalLayout(create, cancel);
        schemaCreateDialog.add(schemaCreateArea, actions);
        add(schemaCreateDialog);
    }

    private void configurePassphraseDialog() {
        passphraseDialog.setCloseOnOutsideClick(false);
        passphraseDialog.setCloseOnEsc(false);
        passphraseField.setWidth("320px");
        passphraseConfirmField.setWidth("320px");
        passphraseField.setValueChangeMode(ValueChangeMode.EAGER);
        passphraseConfirmField.setValueChangeMode(ValueChangeMode.EAGER);

        passphraseField.addValueChangeListener(event -> updatePassphraseSubmitState());
        passphraseConfirmField.addValueChangeListener(event -> updatePassphraseSubmitState());
        passphraseField.addKeyPressListener(Key.ENTER, event -> submitPassphraseIfReady());
        passphraseConfirmField.addKeyPressListener(Key.ENTER, event -> submitPassphraseIfReady());

        passphraseHint.getStyle().set("font-size", "0.9em");
        passphraseError.getStyle().set("color", "var(--lumo-error-text-color)");
        passphraseError.getStyle().set("font-size", "0.9em");

        passphraseSubmit.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        passphraseSubmit.addClickListener(event -> submitPassphrase());
        passphraseCancel.addClickListener(event -> cancelPassphrase());
        passphraseDialog.addOpenedChangeListener(event -> {
            if (event.isOpened()) {
                passphraseField.focus();
            }
        });

        HorizontalLayout actions = new HorizontalLayout(passphraseSubmit, passphraseCancel);
        VerticalLayout content = new VerticalLayout(
            passphraseHint,
            passphraseField,
            passphraseConfirmField,
            passphraseError,
            actions
        );
        content.setPadding(false);
        content.setSpacing(true);

        passphraseDialog.add(content);
        add(passphraseDialog);
    }

    private void configureAuthChallengeDialog() {
        authChallengeDialog.setHeaderTitle("New Challenge");
        authChallengeDialog.setCloseOnOutsideClick(false);
        authChallengeDialog.setCloseOnEsc(true);
        authChallengeJsonArea.setWidth("720px");
        authChallengeJsonArea.setHeight("320px");
        authChallengeJsonArea.setPlaceholder("{ }");

        Button create = new Button("Create", event -> submitAuthChallenge());
        create.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        Button cancel = new Button("Cancel", event -> authChallengeDialog.close());

        HorizontalLayout actions = new HorizontalLayout(create, cancel);
        authChallengeDialog.add(authChallengeJsonArea, actions);
        add(authChallengeDialog);
    }

    private void submitPassphraseIfReady() {
        if (passphraseSubmit.isEnabled()) {
            submitPassphrase();
        }
    }

    private void openCreateDialog() {
        createNameField.clear();
        List<String> registries = loadRegistries();
        createRegistrySelect.setItems(registries);
        if (!registries.isEmpty()) {
            createRegistrySelect.setValue(selectRegistry(registries, createRegistrySelect.getValue()));
        }
        createDialog.open();
    }

    private void openRenameDialog() {
        String selected = currentIdSelect.getValue();
        if (selected == null || selected.isBlank()) {
            showError("Select an ID first");
            return;
        }
        renameField.clear();
        renameDialog.open();
    }

    private void openRecoverDialog() {
        recoverField.clear();
        recoverDialog.open();
    }

    private void confirmRemove() {
        String selected = currentIdSelect.getValue();
        if (selected == null || selected.isBlank()) {
            showError("Select an ID first");
            return;
        }
        removeConfirm.setText("Are you sure you want to remove " + selected + "?");
        removeConfirm.open();
    }

    private void submitCreate() {
        String name = createNameField.getValue();
        String registry = createRegistrySelect.getValue();
        submitCreate(name, registry, () -> createDialog.close());
    }

    private void submitCreateInline() {
        String name = createInlineNameField.getValue();
        String registry = createInlineRegistrySelect.getValue();
        submitCreate(name, registry, this::clearInlineCreate);
    }

    private void submitCreate(String name, String registry, Runnable onSuccess) {
        if (name == null || name.isBlank()) {
            showError("Name is required");
            return;
        }
        if (registry == null || registry.isBlank()) {
            registry = config.getRegistry();
        }

        try {
            keymasterService.createId(name.trim(), registry);
            if (onSuccess != null) {
                onSuccess.run();
            }
            refresh();
            showSuccess("Created ID: " + name.trim());
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void submitRename() {
        String selected = currentIdSelect.getValue();
        String newName = renameField.getValue();
        if (selected == null || selected.isBlank()) {
            showError("Select an ID first");
            return;
        }
        if (newName == null || newName.isBlank()) {
            showError("New name is required");
            return;
        }
        try {
            keymasterService.renameId(selected, newName.trim());
            renameDialog.close();
            refresh();
            showSuccess("Renamed ID to: " + newName.trim());
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void submitRecover() {
        String did = recoverField.getValue();
        if (did == null || did.isBlank()) {
            showError("DID is required");
            return;
        }
        try {
            String message = keymasterService.recoverId(did.trim());
            recoverDialog.close();
            refresh();
            showSuccess(message);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void clearInlineCreate() {
        createInlineNameField.clear();
        createInlineRegistrySelect.clear();
    }

    private void removeSelectedId() {
        String selected = currentIdSelect.getValue();
        if (selected == null || selected.isBlank()) {
            showError("Select an ID first");
            return;
        }
        try {
            keymasterService.removeId(selected);
            refresh();
            showSuccess("Removed ID: " + selected);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void backupId() {
        String selected = currentIdSelect.getValue();
        if (selected == null || selected.isBlank()) {
            showError("Select an ID first");
            return;
        }
        try {
            boolean ok = keymasterService.backupId(selected);
            if (ok) {
                showSuccess("Backup succeeded for " + selected);
            } else {
                showError("Backup failed for " + selected);
            }
            refresh();
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void rotateKeys() {
        try {
            keymasterService.rotateKeys();
            refresh();
            showSuccess("Keys rotated");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private List<String> loadRegistries() {
        try {
            List<String> registries = gatekeeper.listRegistries();
            if (registries == null || registries.isEmpty()) {
                return Collections.singletonList(config.getRegistry());
            }
            return registries;
        } catch (Exception e) {
            showError(e.getMessage());
            return Collections.singletonList(config.getRegistry());
        }
    }

    private void refresh() {
        refreshing = true;
        String previousId = currentIdName;
        if (!keymasterService.isReady()) {
            currentIdSelect.setItems(Collections.emptyList());
            currentIdSelect.clear();
            currentAliasValue.setText("-");
            currentDidValue.setText("-");
            docsArea.clear();
            manifest = new java.util.HashMap<>();
            updateHeldSelectionState();
            hasCurrentId = false;
            refreshNames();
            refreshHeld();
            refreshIssued();
            refreshAuth();
            setTabVisibilityForCurrentId();
            updateIdentityVisibility();
            refreshing = false;
            return;
        }
        String currentId = null;
        try {
            currentId = keymasterService.currentId();
        } catch (Exception e) {
            showError(e.getMessage());
        }

        hasCurrentId = currentId != null && !currentId.isBlank();
        boolean idChanged = (previousId == null && hasCurrentId)
            || (previousId != null && !previousId.equals(currentId));
        if (idChanged) {
            resetForUserChange();
        }
        List<String> ids = Collections.emptyList();
        try {
            ids = keymasterService.listIds();
        } catch (Exception e) {
            showError(e.getMessage());
        }

        currentIdSelect.setItems(ids);
        currentIdSelect.setValue(currentId);

        currentAliasValue.setText(currentId != null ? currentId : "-");
        currentIdName = currentId;

        String did = "-";
        if (currentId != null && !currentId.isBlank()) {
            try {
                MdipDocument doc = keymasterService.resolveDID(currentId);
                if (doc != null && doc.didDocument != null && doc.didDocument.id != null) {
                    did = doc.didDocument.id;
                }
            } catch (Exception e) {
                showError(e.getMessage());
            }
        }
        currentDidValue.setText(did);

        setTabVisibilityForCurrentId();
        updateIdentityVisibility();
        if (hasCurrentId) {
            updateDocs(currentId);
            refreshNames();
            refreshHeld();
            refreshIssued();
            refreshAuth();
        } else {
            docsArea.clear();
            manifest = new java.util.HashMap<>();
            updateHeldSelectionState();
            refreshNames();
            refreshHeld();
            refreshIssued();
            refreshAuth();
        }
        refreshing = false;
    }

    private void resetForUserChange() {
        didNameField.clear();
        didValueField.clear();
        didSelect.clear();
        didDocsArea.clear();
        updateDidActionsState();
        updateDidSelectionState();

        schemaNameField.clear();
        schemaRegistrySelect.clear();
        schemaSelect.clear();
        schemaArea.clear();
        schemaOwned = false;
        selectedSchemaDid = null;
        schemaDetails.setVisible(false);
        schemaCreateArea.clear();
        schemaCreateDialog.close();
        updateSchemaCreateState();
        updateSchemaSelectionState();

        groupNameField.clear();
        groupRegistrySelect.clear();
        groupSelect.clear();
        groupArea.clear();
        groupDetails.setVisible(false);
        selectedGroupDid = null;
        groupMemberField.clear();
        groupMemberSelect.clear();
        groupActionResult.setText("");
        updateGroupMemberControls(false);
        updateGroupSelectionState();
        updateGroupCreateState();

        heldDidField.clear();
        heldSelect.clear();
        heldArea.clear();
        selectedHeldDid = null;
        updateHeldInputState();
        updateHeldSelectionState();

        issuedSelect.clear();
        issuedArea.clear();
        selectedIssuedDid = null;
        issuedOriginal = "";
        issuedEditable = false;
        updateIssuedSelectionState();

        issueSubjectSelect.clear();
        issueSchemaSelect.clear();
        issueRegistrySelect.clear();
        issueArea.clear();
        issueResult.setText("");
        updateIssueButtons();

        authChallengeField.clear();
        authResponseField.clear();
        authDidValue.setText("");
        authStringArea.clear();
        callbackUrl = null;
        disableSendResponse = true;
        authChallengeDialog.close();
        updateAuthButtons();

        walletArea.clear();
        mnemonicArea.clear();
        importMnemonic.clear();
        createNameField.clear();
        createRegistrySelect.clear();
        renameField.clear();
        recoverField.clear();
        createInlineNameField.clear();
        createInlineRegistrySelect.clear();
    }

    private void updateTabVisibility() {
        if (!hasCurrentId && tabs.getSelectedTab() != identitiesTab && tabs.getSelectedTab() != walletTab) {
            tabs.setSelectedTab(identitiesTab);
        }
        Tab selected = tabs.getSelectedTab();
        identityContent.setVisible(selected == identitiesTab);
        didsContent.setVisible(selected == didsTab);
        schemasContent.setVisible(selected == schemasTab);
        groupsContent.setVisible(selected == groupsTab);
        credentialsContent.setVisible(selected == credentialsTab);
        authContent.setVisible(selected == authTab);
        walletContent.setVisible(selected == walletTab);
    }

    private void updateIdentityVisibility() {
        boolean showIdentityDetails = hasCurrentId;
        identityCreatePanel.setVisible(!hasCurrentId);
        identitySelectorPanel.setVisible(showIdentityDetails);
        identityDocsPanel.setVisible(showIdentityDetails);
        identityActionsRow.setVisible(showIdentityDetails);
        renameIdButton.setVisible(showIdentityDetails);
        removeIdButton.setVisible(showIdentityDetails);
        backupIdButton.setVisible(showIdentityDetails);
        recoverIdButton.setVisible(showIdentityDetails);
        rotateKeysButton.setVisible(showIdentityDetails);

        if (!hasCurrentId) {
            List<String> registries = loadRegistries();
            createInlineRegistrySelect.setItems(registries);
            if (!registries.isEmpty()) {
                createInlineRegistrySelect.setValue(selectRegistry(registries, createInlineRegistrySelect.getValue()));
            }
        }
    }

    private void setTabVisibilityForCurrentId() {
        boolean show = hasCurrentId;
        didsTab.setVisible(show);
        schemasTab.setVisible(show);
        groupsTab.setVisible(show);
        credentialsTab.setVisible(show);
        authTab.setVisible(show);
        updateTabVisibility();
    }

    private void updateCredentialTabVisibility() {
        Tab selected = credentialTabs.getSelectedTab();
        heldContent.setVisible(selected == heldTab);
        issueContent.setVisible(selected == issueTab);
        issuedContent.setVisible(selected == issuedTab);
    }

    private void openPassphraseDialog() {
        openPassphraseDialog(!keymasterService.hasWallet(), false);
    }

    private void openPassphraseDialog(boolean createMode, boolean resetMode) {
        passphraseCreateMode = createMode;
        passphraseResetMode = resetMode;
        passphraseDialog.setHeaderTitle(passphraseCreateMode ? "Set Passphrase" : "Unlock Wallet");
        if (passphraseCreateMode) {
            passphraseHint.setText("Create a passphrase to encrypt the wallet.");
        } else if (pendingWallet != null) {
            passphraseHint.setText("Enter your passphrase to unlock the uploaded wallet.");
        } else {
            passphraseHint.setText("Enter your passphrase to unlock the wallet.");
        }
        passphraseSubmit.setText(passphraseCreateMode ? "Set Passphrase" : "Unlock");
        passphraseCancel.setVisible(allowPassphraseCancel());
        passphraseField.clear();
        passphraseConfirmField.clear();
        passphraseConfirmField.setVisible(passphraseCreateMode);
        passphraseError.setText("");
        setPassphraseBusy(false);
        passphraseDialog.open();
    }

    private void submitPassphrase() {
        String passphrase = passphraseField.getValue();
        if (passphrase == null || passphrase.isBlank()) {
            passphraseError.setText("Passphrase is required");
            return;
        }
        if (passphraseCreateMode) {
            String confirm = passphraseConfirmField.getValue();
            if (confirm == null || confirm.isBlank() || !passphrase.equals(confirm)) {
                passphraseError.setText("Passphrases do not match");
                return;
            }
        }
        setPassphraseBusy(true);
        UI ui = UI.getCurrent();
        ui.setPollInterval(500);
        CompletableFuture.runAsync(() -> {
            if (pendingWallet != null) {
                keymasterService.initWithUploadedWallet(passphrase, pendingWallet);
            } else if (passphraseResetMode) {
                keymasterService.resetWallet(passphrase);
            } else {
                keymasterService.initWithPassphrase(passphrase, passphraseCreateMode);
            }
        }).whenComplete((ignored, error) -> ui.access(() -> {
            ui.setPollInterval(-1);
            if (error == null) {
                pendingWallet = null;
                setReady(true);
                passphraseDialog.close();
                refresh();
            } else {
                passphraseError.setText("Incorrect passphrase");
            }
            setPassphraseBusy(false);
        }));
    }

    private void setReady(boolean ready) {
        this.ready = ready;
        identityContent.setEnabled(ready);
        didsContent.setEnabled(ready);
        schemasContent.setEnabled(ready);
        groupsContent.setEnabled(ready);
        credentialsContent.setEnabled(ready);
        authContent.setEnabled(ready);
        walletContent.setEnabled(ready);
        currentIdSelect.setEnabled(ready);
        tabs.setEnabled(ready);
    }

    private void updatePassphraseSubmitState() {
        String passphrase = passphraseField.getValue();
        boolean hasPassphrase = passphrase != null && !passphrase.isBlank();
        if (passphraseCreateMode) {
            String confirm = passphraseConfirmField.getValue();
            boolean hasConfirm = confirm != null && !confirm.isBlank();
            passphraseSubmit.setEnabled(hasPassphrase && hasConfirm && passphrase.equals(confirm));
        } else {
            passphraseSubmit.setEnabled(hasPassphrase);
        }
    }

    private void setPassphraseBusy(boolean busy) {
        passphraseField.setEnabled(!busy);
        passphraseConfirmField.setEnabled(!busy && passphraseCreateMode);
        if (busy) {
            passphraseSubmit.setEnabled(false);
            passphraseCancel.setEnabled(false);
        } else {
            updatePassphraseSubmitState();
            passphraseCancel.setEnabled(allowPassphraseCancel());
        }
    }

    private boolean allowPassphraseCancel() {
        return pendingWallet != null || passphraseResetMode;
    }

    private void cancelPassphrase() {
        pendingWallet = null;
        passphraseDialog.close();
        setReady(true);
        refresh();
    }

    private void handleWalletUpload() {
        try (InputStream input = uploadBuffer.getInputStream()) {
            String json = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            WalletEncFile wallet = keymasterService.parseWalletEncFile(json);
            pendingWallet = wallet;
            setReady(false);
            upload.clearFileList();
            openPassphraseDialog(false, false);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void confirmNewWallet() {
        setReady(false);
        openPassphraseDialog(true, true);
    }

    private void openImportDialog() {
        importMnemonic.clear();
        importDialog.open();
    }

    private void openSchemaCreateDialog() {
        String name = schemaNameField.getValue();
        if (name == null || name.isBlank()) {
            showError("Schema name is required");
            return;
        }
        try {
            keymasterService.validateName(name);
            java.util.Map<String, String> names = keymasterService.listNames(true);
            if (names != null && names.containsKey(name.trim())) {
                showError("Invalid parameter: name already used");
                return;
            }
        } catch (Exception e) {
            showError(e.getMessage());
            return;
        }
        schemaCreateArea.setValue(DEFAULT_SCHEMA_JSON);
        List<String> registries = loadRegistries();
        String selected = schemaRegistrySelect.getValue();
        schemaRegistrySelect.setItems(registries);
        schemaRegistrySelect.setValue(selectRegistry(registries, selected));
        schemaCreateDialog.open();
    }

    private void refreshNames() {
        if (!keymasterService.isReady() || !hasCurrentId) {
            didNameMap = new java.util.HashMap<>();
            didToName = new java.util.HashMap<>();
            agentNames = new java.util.ArrayList<>();
            schemaNames = new java.util.ArrayList<>();
            groupNames = new java.util.ArrayList<>();

            didSelect.setItems(Collections.emptyList());
            didSelect.clear();
            didDocsArea.clear();
            updateDidActionsState();
            updateDidSelectionState();

            schemaSelect.setItems(Collections.emptyList());
            schemaSelect.clear();
            schemaArea.clear();
            schemaDetails.setVisible(false);
            updateSchemaSelectionState();

            groupSelect.setItems(Collections.emptyList());
            groupSelect.clear();
            groupArea.clear();
            groupDetails.setVisible(false);
            selectedGroupDid = null;
            groupActionResult.setText("");
            groupMemberField.clear();
            groupMemberSelect.clear();
            updateGroupMemberControls(false);
            updateGroupSelectionState();

            issueSubjectSelect.setItems(Collections.emptyList());
            issueSchemaSelect.setItems(Collections.emptyList());
            issueRegistrySelect.setItems(Collections.emptyList());
            updateIssueButtons();

            return;
        }

        java.util.Map<String, String> namesMap;
        try {
            namesMap = keymasterService.listNames(false);
        } catch (Exception e) {
            showError(e.getMessage());
            return;
        }

        didNameMap = new java.util.HashMap<>(namesMap);
        didToName = new java.util.HashMap<>();
        java.util.List<String> names = new java.util.ArrayList<>(didNameMap.keySet());
        java.util.Collections.sort(names);

        java.util.List<String> ids;
        try {
            ids = keymasterService.listIds();
        } catch (Exception e) {
            ids = new java.util.ArrayList<>();
        }

        for (String id : ids) {
            if (id == null || id.isBlank() || didNameMap.containsKey(id)) {
                continue;
            }
            try {
                MdipDocument doc = keymasterService.resolveDID(id);
                if (doc != null && doc.didDocument != null && doc.didDocument.id != null) {
                    didNameMap.put(id, doc.didDocument.id);
                }
            } catch (Exception ignored) {
                // ignore unresolved ids
            }
        }

        names = new java.util.ArrayList<>(didNameMap.keySet());
        java.util.Collections.sort(names);

        for (java.util.Map.Entry<String, String> entry : didNameMap.entrySet()) {
            didToName.put(entry.getValue(), entry.getKey());
        }

        java.util.Set<String> agentSet = new java.util.LinkedHashSet<>(ids);
        java.util.List<String> schemas = new java.util.ArrayList<>();
        java.util.List<String> groups = new java.util.ArrayList<>();

        for (String name : names) {
            try {
                MdipDocument doc = keymasterService.resolveDID(name);
                if (doc != null && doc.mdip != null && "agent".equals(doc.mdip.type)) {
                    agentSet.add(name);
                    continue;
                }
                if (doc != null && doc.didDocumentData instanceof java.util.Map<?, ?>) {
                    java.util.Map<?, ?> data = (java.util.Map<?, ?>) doc.didDocumentData;
                    if (data.containsKey("schema")) {
                        schemas.add(name);
                        continue;
                    }
                    if (data.containsKey("group")) {
                        groups.add(name);
                    }
                }
            } catch (Exception ignored) {
                // Skip unresolvable names.
            }
        }

        agentNames = new java.util.ArrayList<>(agentSet);
        schemaNames = schemas;
        groupNames = groups;

        didSelect.setItems(names);
        if (didSelect.getValue() == null || !didNameMap.containsKey(didSelect.getValue())) {
            didSelect.clear();
            didDocsArea.clear();
        }
        updateDidSelectionState();

        schemaSelect.setItems(schemaNames);
        if (selectedSchemaDid != null && schemaNames.contains(selectedSchemaDid)) {
            schemaSelect.setValue(selectedSchemaDid);
            schemaDetails.setVisible(true);
        } else {
            selectedSchemaDid = null;
            schemaSelect.clear();
            schemaArea.clear();
            schemaDetails.setVisible(false);
        }
        updateSchemaSelectionState();

        groupSelect.setItems(groupNames);
        if (selectedGroupDid != null && groupNames.contains(selectedGroupDid)) {
            groupSelect.setValue(selectedGroupDid);
            groupDetails.setVisible(true);
        } else {
            selectedGroupDid = null;
            groupSelect.clear();
            groupArea.clear();
            groupDetails.setVisible(false);
            groupMemberField.clear();
            groupMemberSelect.clear();
            groupActionResult.setText("");
            updateGroupMemberControls(false);
        }
        updateGroupSelectionState();

        issueSubjectSelect.setItems(agentNames);
        if (issueSubjectSelect.getValue() != null && !agentNames.contains(issueSubjectSelect.getValue())) {
            issueSubjectSelect.clear();
            issueArea.clear();
            issueResult.setText("");
        }

        issueSchemaSelect.setItems(schemaNames);
        if (issueSchemaSelect.getValue() != null && !schemaNames.contains(issueSchemaSelect.getValue())) {
            issueSchemaSelect.clear();
            issueArea.clear();
            issueResult.setText("");
        }

        List<String> registries = loadRegistries();
        issueRegistrySelect.setItems(registries);
        issueRegistrySelect.setValue(selectRegistry(registries, issueRegistrySelect.getValue()));
        String schemaRegistry = schemaRegistrySelect.getValue();
        schemaRegistrySelect.setItems(registries);
        schemaRegistrySelect.setValue(selectRegistry(registries, schemaRegistry));
        String groupRegistry = groupRegistrySelect.getValue();
        groupRegistrySelect.setItems(registries);
        groupRegistrySelect.setValue(selectRegistry(registries, groupRegistry));

        updateIssueButtons();
    }

    private void refreshHeld() {
        if (!keymasterService.isReady() || !hasCurrentId) {
            heldSelect.setItems(Collections.emptyList());
            heldSelect.clear();
            heldArea.clear();
            heldDidField.clear();
            updateHeldSelectionState();
            return;
        }
        try {
            List<String> held = keymasterService.listCredentials();
            heldSelect.setItems(held);
            if (selectedHeldDid != null && held.contains(selectedHeldDid)) {
                heldSelect.setValue(selectedHeldDid);
            } else {
                selectedHeldDid = null;
                heldSelect.clear();
                heldArea.clear();
            }
            updateHeldSelectionState();
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void refreshIssued() {
        if (!keymasterService.isReady() || !hasCurrentId) {
            issuedSelect.setItems(Collections.emptyList());
            issuedSelect.clear();
            issuedArea.clear();
            issuedEditable = false;
            issuedOriginal = "";
            updateIssuedSelectionState();
            return;
        }
        try {
            List<String> issued = keymasterService.listIssued();
            issuedSelect.setItems(issued);
            if (selectedIssuedDid != null && issued.contains(selectedIssuedDid)) {
                issuedSelect.setValue(selectedIssuedDid);
            } else {
                selectedIssuedDid = null;
                issuedSelect.clear();
                issuedArea.clear();
                issuedEditable = false;
                issuedOriginal = "";
            }
            updateIssuedSelectionState();
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void editCredential() {
        String subject = issueSubjectSelect.getValue();
        String schema = issueSchemaSelect.getValue();
        if (subject == null || subject.isBlank() || schema == null || schema.isBlank()) {
            showError("Select a subject and schema");
            return;
        }
        try {
            java.util.Map<String, Object> bound = keymasterService.bindCredential(schema, subject);
            issueArea.setValue(keymasterService.prettyJson(bound));
            issueResult.setText("");
            updateIssueButtons();
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void issueCredential() {
        String json = issueArea.getValue();
        if (json == null || json.isBlank()) {
            showError("Credential JSON is required");
            return;
        }
        String registry = issueRegistrySelect.getValue();
        if (!canUseRegistry(registry, "credential")) {
            return;
        }
        try {
            Object parsed = keymasterService.parseJson(json);
            if (!(parsed instanceof java.util.Map<?, ?>)) {
                showError("Credential must be an object");
                return;
            }
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> map = (java.util.Map<String, Object>) parsed;
            String did = keymasterService.issueCredential(map, registry);
            issueResult.setText(did);
            updateIssueButtons();
            refreshIssued();
            showSuccess("Credential issued");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void updateIssueButtons() {
        String subject = issueSubjectSelect.getValue();
        String schema = issueSchemaSelect.getValue();
        boolean canEdit = subject != null && !subject.isBlank() && schema != null && !schema.isBlank();
        issueEditButton.setEnabled(canEdit);

        String json = issueArea.getValue();
        boolean hasRegistry = issueRegistrySelect.getValue() != null && !issueRegistrySelect.getValue().isBlank();
        boolean canIssue = json != null && !json.isBlank() && hasRegistry;
        issueButton.setEnabled(canIssue);
    }

    private void resolveIssued() {
        String did = issuedSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            MdipDocument doc = keymasterService.resolveDID(did);
            issuedArea.setReadOnly(true);
            issuedArea.setValue(keymasterService.prettyJson(doc));
            issuedEditable = false;
            issuedOriginal = issuedArea.getValue();
            selectedIssuedDid = did;
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void decryptIssued() {
        String did = issuedSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            Object credential = keymasterService.decryptJSON(did);
            String json = keymasterService.prettyJson(credential);
            issuedArea.setReadOnly(false);
            issuedArea.setValue(json);
            issuedEditable = true;
            issuedOriginal = json;
            selectedIssuedDid = did;
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void updateIssued() {
        String did = issuedSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        if (!issuedEditable) {
            showError("Decrypt the credential before updating");
            return;
        }
        String json = issuedArea.getValue();
        if (json == null || json.isBlank()) {
            showError("Credential JSON is required");
            return;
        }
        if (json.equals(issuedOriginal)) {
            showError("No changes to update");
            return;
        }
        try {
            Object parsed = keymasterService.parseJson(json);
            if (!(parsed instanceof java.util.Map<?, ?>)) {
                showError("Credential must be an object");
                return;
            }
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> map = (java.util.Map<String, Object>) parsed;
            boolean ok = keymasterService.updateCredential(did, map);
            if (!ok) {
                showError("Credential not updated");
                return;
            }
            issuedOriginal = json;
            resetHeldSelection();
            showSuccess("Credential updated");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void revokeIssued() {
        String did = issuedSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            boolean ok = keymasterService.revokeCredential(did);
            if (!ok) {
                showError("Credential not revoked");
                return;
            }
            refreshIssued();
            resetHeldSelection();
            showSuccess("Credential revoked");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void resolveHeld() {
        String did = heldSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            MdipDocument doc = keymasterService.resolveDID(did);
            heldArea.setValue(keymasterService.prettyJson(doc));
            selectedHeldDid = did;
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void decryptHeld() {
        String did = heldSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            Object credential = keymasterService.decryptJSON(did);
            heldArea.setValue(keymasterService.prettyJson(credential));
            selectedHeldDid = did;
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void acceptHeld() {
        String did = heldSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            boolean ok = keymasterService.acceptCredential(did);
            if (!ok) {
                showError("Credential not accepted");
                return;
            }
            refreshHeld();
            showSuccess("Credential accepted");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void resolveHeldInput() {
        String did = heldDidField.getValue();
        try {
            MdipDocument doc = keymasterService.resolveDID(did.trim());
            heldArea.setValue(keymasterService.prettyJson(doc));
            selectedHeldDid = did.trim();
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void resolveHeldSelected() {
        String did = heldSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            MdipDocument doc = keymasterService.resolveDID(did);
            selectedHeldDid = did;
            heldArea.setValue(keymasterService.prettyJson(doc));
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void decryptHeldInput() {
        String did = heldDidField.getValue();
        try {
            Object credential = keymasterService.decryptJSON(did.trim());
            heldArea.setValue(keymasterService.prettyJson(credential));
            selectedHeldDid = did.trim();
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void decryptHeldSelected() {
        String did = heldSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            Object credential = keymasterService.decryptJSON(did);
            selectedHeldDid = did;
            heldArea.setValue(keymasterService.prettyJson(credential));
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void acceptHeldInput() {
        String did = heldDidField.getValue();
        try {
            boolean ok = keymasterService.acceptCredential(did.trim());
            if (!ok) {
                showError("Credential not accepted");
                return;
            }
            refreshHeld();
            showSuccess("Credential accepted");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void removeHeld() {
        String did = heldSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            boolean ok = keymasterService.removeCredential(did);
            if (!ok) {
                showError("Credential not removed");
                return;
            }
            refreshHeld();
            showSuccess("Credential removed");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void publishHeld(boolean reveal) {
        String did = heldSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            Object result = keymasterService.publishCredential(did, reveal);
            heldArea.setValue(keymasterService.prettyJson(result));
            if (hasCurrentId && currentIdName != null && !currentIdName.isBlank()) {
                updateDocs(currentIdName);
            }
            showSuccess(reveal ? "Credential revealed" : "Credential published");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void unpublishHeld() {
        String did = heldSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a credential first");
            return;
        }
        try {
            keymasterService.unpublishCredential(did);
            if (hasCurrentId && currentIdName != null && !currentIdName.isBlank()) {
                updateDocs(currentIdName);
            }
            showSuccess("Credential unpublished");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void resolveDidInput() {
        String didOrName = didValueField.getValue();
        if (didOrName == null || didOrName.isBlank()) {
            didOrName = didNameField.getValue();
        }
        if (didOrName == null || didOrName.isBlank()) {
            showError("Name or DID is required");
            return;
        }
        try {
            MdipDocument doc = keymasterService.resolveDID(didOrName.trim());
            didDocsArea.setValue(keymasterService.prettyJson(doc));
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void resolveSelectedName() {
        String name = didSelect.getValue();
        if (name == null || name.isBlank()) {
            showError("Select a name first");
            return;
        }
        try {
            MdipDocument doc = keymasterService.resolveDID(name.trim());
            didDocsArea.setValue(keymasterService.prettyJson(doc));
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void addDidName() {
        String name = didNameField.getValue();
        String did = didValueField.getValue();
        if (name == null || name.isBlank()) {
            showError("Name is required");
            return;
        }
        if (did == null || did.isBlank()) {
            showError("DID is required");
            return;
        }
        try {
            keymasterService.addName(name.trim(), did.trim());
            refreshNames();
            showSuccess("Name added");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void removeSelectedName() {
        String name = didSelect.getValue();
        if (name == null || name.isBlank()) {
            showError("Select a name first");
            return;
        }
        try {
            keymasterService.removeName(name);
            refreshNames();
            showSuccess("Name removed");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void updateDidActionsState() {
        String did = didValueField.getValue();
        String name = didNameField.getValue();
        boolean hasDid = did != null && !did.isBlank();
        boolean hasName = name != null && !name.isBlank();

        didResolveButton.setEnabled(hasDid);
        didAddButton.setEnabled(hasDid && hasName);
    }

    private void updateDidSelectionState() {
        String selected = didSelect.getValue();
        setButtonsEnabledOnValue(selected, didResolveSelectedButton, didRemoveButton, didCopyButton);
    }

    private void copySelectedDid() {
        String name = didSelect.getValue();
        if (name == null || name.isBlank()) {
            return;
        }
        String did = didNameMap.get(name);
        if (did == null || did.isBlank()) {
            showError("No DID found for selection");
            return;
        }
        copyToClipboard(did);
    }

    private void updateSchemaSelectionState() {
        String selected = schemaSelect.getValue();
        setButtonsEnabledOnValue(selected, schemaCopyButton);
    }

    private void updateGroupSelectionState() {
        String selected = groupSelect.getValue();
        setButtonsEnabledOnValue(selected, groupCopyButton);
    }

    private void updateIssuedSelectionState() {
        String selected = issuedSelect.getValue();
        setButtonsEnabledOnValue(selected, issuedCopyButton);
    }

    private void resetHeldSelection() {
        heldSelect.clear();
        selectedHeldDid = null;
        heldArea.clear();
        updateHeldSelectionState();
    }

    private void setButtonsEnabledOnValue(String value, Button... buttons) {
        boolean enabled = value != null && !value.isBlank();
        for (Button button : buttons) {
            button.setEnabled(enabled);
        }
    }

    private void copySchemaDid() {
        String name = schemaSelect.getValue();
        if (name == null || name.isBlank()) {
            return;
        }
        String did = didNameMap.get(name);
        if (did == null || did.isBlank()) {
            showError("No DID found for selection");
            return;
        }
        copyToClipboard(did);
    }

    private void copyGroupDid() {
        String name = groupSelect.getValue();
        if (name == null || name.isBlank()) {
            return;
        }
        String did = didNameMap.get(name);
        if (did == null || did.isBlank()) {
            showError("No DID found for selection");
            return;
        }
        copyToClipboard(did);
    }

    private void copyHeldDid() {
        String did = heldSelect.getValue();
        if (did == null || did.isBlank()) {
            return;
        }
        copyToClipboard(did);
    }

    private void copyIssuedDid() {
        String did = issuedSelect.getValue();
        if (did == null || did.isBlank()) {
            return;
        }
        copyToClipboard(did);
    }

    private void wireCopyButton(Button button, Runnable action) {
        button.addThemeVariants(ButtonVariant.LUMO_PRIMARY);
        button.addClickListener(event -> action.run());
    }

    private void copyToClipboard(String value) {
        UI ui = UI.getCurrent();
        ui.getPage().executeJs("navigator.clipboard.writeText($0)", value)
            .then(success -> showSuccess("Copied to clipboard"));
    }

    private void selectSchema(String did) {
        try {
            MdipDocument doc = keymasterService.resolveDID(did);
            Object schema = doc != null && doc.didDocumentData instanceof java.util.Map<?, ?>
                ? ((java.util.Map<?, ?>) doc.didDocumentData).get("schema")
                : null;
            schemaOwned = doc != null && doc.didDocumentMetadata != null && Boolean.TRUE.equals(doc.didDocumentMetadata.isOwned);
            selectedSchemaDid = did;
            schemaArea.setReadOnly(!schemaOwned);
            schemaArea.setValue(keymasterService.prettyJson(schema));
            schemaDetails.setVisible(true);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void selectGroup(String did) {
        try {
            MdipDocument doc = keymasterService.resolveDID(did);
            groupArea.setValue(keymasterService.prettyJson(doc));
            groupDetails.setVisible(true);
            selectedGroupDid = did;
            groupActionResult.setText("");

            String controller = doc != null && doc.didDocument != null ? doc.didDocument.controller : null;
            String currentDid = currentDidValue.getText();
            boolean canEdit = controller != null && currentDid != null
                && !currentDid.isBlank() && !"-".equals(currentDid)
                && controller.equals(currentDid);
            updateGroupMemberControls(canEdit);

            java.util.List<String> members = extractGroupMembers(doc);
            updateGroupMemberSelect(members);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void updateGroupMemberControls(boolean canEdit) {
        groupAddButton.setVisible(canEdit);
        groupRemoveButton.setVisible(canEdit);
        groupTestButton.setVisible(true);
        groupMemberSelect.setVisible(canEdit);
        groupMemberButtonsRow.setVisible(canEdit);
        updateGroupMemberActionState();
    }

    private void updateGroupMemberActionState() {
        String member = groupMemberField.getValue();
        boolean hasMemberText = member != null && !member.isBlank();
        String selected = groupMemberSelect.getValue();
        boolean hasSelection = selected != null && !selected.isBlank();

        groupAddButton.setEnabled(hasMemberText);
        groupTestButton.setEnabled(hasMemberText);
        groupRemoveButton.setEnabled(hasSelection);
    }

    private java.util.List<String> extractGroupMembers(MdipDocument doc) {
        java.util.List<String> members = new java.util.ArrayList<>();
        if (doc == null || !(doc.didDocumentData instanceof java.util.Map<?, ?>)) {
            return members;
        }
        java.util.Map<?, ?> data = (java.util.Map<?, ?>) doc.didDocumentData;
        Object groupObj = data.get("group");
        if (!(groupObj instanceof java.util.Map<?, ?>)) {
            return members;
        }
        Object membersObj = ((java.util.Map<?, ?>) groupObj).get("members");
        if (membersObj instanceof java.util.List<?>) {
            for (Object item : (java.util.List<?>) membersObj) {
                if (item instanceof String) {
                    members.add((String) item);
                }
            }
        }
        return members;
    }

    private void updateGroupMemberSelect(java.util.List<String> memberDids) {
        java.util.List<String> items = new java.util.ArrayList<>();
        for (String did : memberDids) {
            String name = didToName.get(did);
            items.add(name != null ? name : did);
        }
        java.util.Collections.sort(items);
        groupMemberSelect.setItems(items);
        groupMemberSelect.clear();
    }

    private void createGroup() {
        String name = groupNameField.getValue();
        String registry = groupRegistrySelect.getValue();
        if (!canUseRegistry(registry, "group")) {
            return;
        }
        try {
            String did = keymasterService.createGroup(name.trim(), registry);
            groupNameField.clear();
            refreshNames();
            groupSelect.setValue(name.trim());
            selectGroup(name.trim());
            showSuccess("Group created");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void refreshAuth() {
        if (!keymasterService.isReady() || !hasCurrentId) {
            authChallengeField.clear();
            authResponseField.clear();
            authDidValue.setText("");
            authStringArea.clear();
            callbackUrl = null;
            disableSendResponse = true;
            updateAuthButtons();
        }
    }

    private void openAuthChallengeDialog() {
        authChallengeJsonArea.setValue("{ }");
        authChallengeDialog.open();
    }

    private void submitAuthChallenge() {
        String text = authChallengeJsonArea.getValue();
        java.util.Map<String, Object> map = new java.util.LinkedHashMap<>();
        if (text != null && !text.isBlank()) {
            try {
                Object parsed = keymasterService.parseJson(text);
                if (!(parsed instanceof java.util.Map<?, ?>)) {
                    showError("Challenge JSON must be an object");
                    return;
                }
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> parsedMap = (java.util.Map<String, Object>) parsed;
                map = parsedMap;
            } catch (Exception e) {
                showError(e.getMessage());
                return;
            }
        }
        if (!canUseRegistry(config.getRegistry(), "challenge")) {
            return;
        }
        try {
            String did = keymasterService.createChallenge(map, null);
            authChallengeDialog.close();
            authChallengeField.setValue(did);
            resolveChallenge(did);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void resolveChallenge(String did) {
        try {
            Object asset = keymasterService.resolveAsset(did.trim());
            setAuthOutput(did.trim(), asset);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void createResponse() {
        String challengeDid = authChallengeField.getValue();
        try {
            if (!canUseRegistry(config.getRegistry(), "response")) {
                return;
            }
            clearResponse();
            String responseDid = keymasterService.createResponse(challengeDid.trim());
            authResponseField.setValue(responseDid);

            Object asset = keymasterService.resolveAsset(challengeDid.trim());
            callbackUrl = extractCallback(asset);
            disableSendResponse = callbackUrl == null || callbackUrl.isBlank();
            updateAuthButtons();

            decryptResponse(responseDid);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void clearChallenge() {
        authChallengeField.clear();
        updateAuthButtons();
    }

    private void decryptResponse(String responseDid) {
        try {
            Object decrypted = keymasterService.decryptJSON(responseDid.trim());
            setAuthOutput(responseDid.trim(), decrypted);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void verifyResponse() {
        String responseDid = authResponseField.getValue();
        try {
            java.util.Map<String, Object> result = keymasterService.verifyResponse(responseDid.trim());
            boolean match = result != null && Boolean.TRUE.equals(result.get("match"));
            if (match) {
                showSuccess("Response is VALID");
            } else {
                showError("Response is NOT VALID");
            }
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void clearResponse() {
        authResponseField.clear();
        disableSendResponse = true;
        callbackUrl = null;
        updateAuthButtons();
    }

    private void sendResponse() {
        String responseDid = authResponseField.getValue();
        if (callbackUrl == null || callbackUrl.isBlank()) {
            showError("No callback configured for this challenge");
            return;
        }
        disableSendResponse = true;
        updateAuthButtons();
        UI ui = UI.getCurrent();
        CompletableFuture.runAsync(() -> {
            try {
                keymasterService.sendResponse(callbackUrl, responseDid.trim());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }).whenComplete((ignored, error) -> ui.access(() -> {
            if (error != null) {
                showError(error.getCause() != null ? error.getCause().getMessage() : error.getMessage());
            } else {
                showSuccess("Response sent");
            }
            disableSendResponse = callbackUrl == null || callbackUrl.isBlank();
            updateAuthButtons();
        }));
    }

    private void setAuthOutput(String did, Object value) {
        authDidValue.setText(did);
        authStringArea.setValue(keymasterService.prettyJson(value));
        updateAuthButtons();
    }

    private void updateAuthButtons() {
        String challenge = authChallengeField.getValue();
        String response = authResponseField.getValue();
        String current = authDidValue.getText();

        boolean hasChallenge = challenge != null && !challenge.isBlank();
        boolean hasResponse = response != null && !response.isBlank();
        boolean canResolve = hasChallenge && (current == null || !challenge.equals(current));
        boolean canDecrypt = hasResponse && (current == null || !response.equals(current));

        authResolveButton.setEnabled(canResolve);
        authRespondButton.setEnabled(hasChallenge);
        authClearChallengeButton.setEnabled(hasChallenge);

        authDecryptButton.setEnabled(canDecrypt);
        authVerifyButton.setEnabled(hasResponse);
        authSendButton.setEnabled(!disableSendResponse);
        authClearResponseButton.setEnabled(hasResponse);
    }

    private String extractCallback(Object asset) {
        if (!(asset instanceof java.util.Map<?, ?>)) {
            return null;
        }
        java.util.Map<?, ?> map = (java.util.Map<?, ?>) asset;
        Object challengeObj = map.get("challenge");
        if (!(challengeObj instanceof java.util.Map<?, ?>)) {
            return null;
        }
        Object callback = ((java.util.Map<?, ?>) challengeObj).get("callback");
        return callback instanceof String ? (String) callback : null;
    }

    private void addGroupMember() {
        String group = groupSelect.getValue();
        String member = groupMemberField.getValue();
        if (group == null || group.isBlank()) {
            showError("Select a group first");
            return;
        }
        try {
            boolean ok = keymasterService.addGroupMember(group, member.trim());
            if (!ok) {
                showError("Member not added");
                return;
            }
            selectGroup(group);
            showSuccess("Member added");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void removeGroupMember() {
        String group = groupSelect.getValue();
        String selected = groupMemberSelect.getValue();
        if (group == null || group.isBlank()) {
            showError("Select a group first");
            return;
        }
        try {
            String memberDid = didNameMap.containsKey(selected) ? didNameMap.get(selected) : selected;
            boolean ok = keymasterService.removeGroupMember(group, memberDid.trim());
            if (!ok) {
                showError("Member not removed");
                return;
            }
            selectGroup(group);
            showSuccess("Member removed");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void testGroupMember() {
        String group = groupSelect.getValue();
        String member = groupMemberField.getValue();
        if (group == null || group.isBlank()) {
            showError("Select a group first");
            return;
        }
        try {
            boolean ok = keymasterService.testGroup(group, member.trim());
            groupActionResult.setText(ok ? "Member found" : "Not a member");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void refreshSelectedSchema() {
        String did = schemaSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a schema first");
            return;
        }
        selectSchema(did);
    }

    private void submitSchemaCreate() {
        String name = schemaNameField.getValue();
        String registry = schemaRegistrySelect.getValue();
        String schemaJson = schemaCreateArea.getValue();
        Object schema = null;

        if (!canUseRegistry(registry, "schema")) {
            return;
        }
        if (schemaJson != null && !schemaJson.isBlank()) {
            try {
                schema = keymasterService.parseJson(schemaJson);
            } catch (Exception e) {
                showError(e.getMessage());
                return;
            }
        }

        try {
            String did = keymasterService.createSchema(schema, registry, name);
            schemaCreateDialog.close();
            refreshNames();
            schemaSelect.setValue(name.trim());
            selectSchema(name.trim());
            showSuccess("Schema created");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void saveSchema() {
        String did = schemaSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a schema first");
            return;
        }
        if (!schemaOwned) {
            showError("You must own the schema to update it");
            return;
        }
        String schemaJson = schemaArea.getValue();
        if (schemaJson == null || schemaJson.isBlank()) {
            showError("Schema JSON is required");
            return;
        }
        try {
            Object schema = keymasterService.parseJson(schemaJson);
            keymasterService.setSchema(did, schema);
            selectSchema(did);
            showSuccess("Schema updated");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void testSchema() {
        String did = schemaSelect.getValue();
        if (did == null || did.isBlank()) {
            showError("Select a schema first");
            return;
        }
        try {
            boolean ok = keymasterService.testSchema(did);
            if (ok) {
                showSuccess("Schema is valid");
            } else {
                showError("Schema is invalid");
            }
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void confirmRecoverWallet() {
        recoverWalletConfirm.open();
    }

    private void submitImport() {
        String mnemonic = importMnemonic.getValue();
        if (mnemonic == null || mnemonic.isBlank()) {
            showError("Mnemonic is required");
            return;
        }
        try {
            keymasterService.newWallet(mnemonic.trim(), true);
            keymasterService.recoverWallet();
            importDialog.close();
            refresh();
            showSuccess("Imported wallet");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void backupWallet() {
        try {
            keymasterService.backupWallet();
            showSuccess("Wallet backup successful");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void recoverWallet() {
        try {
            keymasterService.recoverWallet();
            refresh();
            showSuccess("Wallet recovered");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void checkWallet() {
        checkWalletButton.setEnabled(false);
        try {
            CheckWalletResult result = keymasterService.checkWallet();
            if (result == null) {
                showError("Wallet check failed");
                return;
            }

            if (result.invalid == 0 && result.deleted == 0) {
                showError(result.checked + " DIDs checked, no problems found");
                return;
            }

            fixWalletConfirm.setText(result.checked + " DIDs checked\n"
                    + result.invalid + " invalid DIDs found\n"
                    + result.deleted + " deleted DIDs found\n\nFix wallet?");
            fixWalletConfirm.open();
        } catch (Exception e) {
            showError(e.getMessage());
        } finally {
            checkWalletButton.setEnabled(true);
        }
    }

    private void fixWallet() {
        try {
            FixWalletResult result = keymasterService.fixWallet();
            if (result == null) {
                showError("Wallet fix failed");
                return;
            }
            showError(result.idsRemoved + " IDs removed\n"
                    + result.ownedRemoved + " owned DIDs removed\n"
                    + result.heldRemoved + " held DIDs removed\n"
                    + result.namesRemoved + " names removed");
            refresh();
        } catch (Exception e) {
            showError(e.getMessage());
        } finally {
        }
    }

    private void showMnemonic() {
        try {
            String mnemonic = keymasterService.decryptMnemonic();
            mnemonicArea.setValue(mnemonic != null ? mnemonic : "");
            mnemonicDialog.open();
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void showWallet() {
        try {
            WalletFile wallet = keymasterService.loadWallet();
            walletArea.setValue(keymasterService.prettyJson(wallet));
            walletDialog.open();
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void prepareWalletDownload() {
        try {
            WalletEncFile wallet = keymasterService.exportEncryptedWallet();
            String json = keymasterService.prettyJson(wallet);
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            StreamResource resource = new StreamResource("keymaster-wallet.json",
                    () -> new ByteArrayInputStream(bytes));
            downloadAnchor.setHref(resource);
            downloadAnchor.getElement().callJsFunction("click");
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void setCurrentId(String selected) {
        try {
            if (selected.equals(currentIdName)) {
                return;
            }
            keymasterService.setCurrentId(selected);
            refresh();
            showSuccess("Current ID set to: " + selected);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void updateDocs(String nameOrDid) {
        if (nameOrDid == null || nameOrDid.isBlank()) {
            docsArea.clear();
            manifest = new java.util.HashMap<>();
            updateHeldSelectionState();
            return;
        }

        try {
            MdipDocument doc = keymasterService.resolveDID(nameOrDid);
            docsArea.setValue(keymasterService.prettyJson(doc));
            manifest = extractManifest(doc);
            updateHeldSelectionState();
        } catch (Exception e) {
            docsArea.setValue(String.valueOf(e.getMessage()));
            showError(e.getMessage());
        }
    }

    private boolean canUseRegistry(String targetRegistry, String assetType) {
        if (targetRegistry == null || targetRegistry.isBlank()) {
            return true;
        }
        if (currentIdName == null || currentIdName.isBlank()) {
            return true;
        }
        try {
            MdipDocument doc = keymasterService.resolveDID(currentIdName);
            String registry = doc != null && doc.mdip != null ? doc.mdip.registry : null;
            if ("local".equalsIgnoreCase(registry) && !"local".equalsIgnoreCase(targetRegistry)) {
                showError("Local agent cannot create a non-local " + assetType);
                return false;
            }
        } catch (Exception e) {
            showError(e.getMessage());
            return false;
        }
        return true;
    }

    private void updateHeldSelectionState() {
        String did = heldSelect.getValue();
        boolean hasSelection = did != null && !did.isBlank();

        heldResolveSelectedButton.setEnabled(hasSelection);
        heldCopyButton.setEnabled(hasSelection);

        if (!hasSelection) {
            heldDecryptSelectedButton.setEnabled(false);
            heldRemoveButton.setEnabled(false);
            heldPublishButton.setEnabled(false);
            heldRevealButton.setEnabled(false);
            heldUnpublishButton.setEnabled(false);
            return;
        }

        boolean deactivatedEmpty = isDeactivatedEmptyCredential(did);
        if (deactivatedEmpty) {
            boolean unpublished = credentialUnpublished(did);
            heldDecryptSelectedButton.setEnabled(false);
            heldPublishButton.setEnabled(false);
            heldRevealButton.setEnabled(false);
            heldRemoveButton.setEnabled(true);
            heldUnpublishButton.setEnabled(!unpublished);
            return;
        }

        heldDecryptSelectedButton.setEnabled(true);
        boolean unpublished = credentialUnpublished(did);
        boolean published = credentialPublished(did);
        boolean revealed = credentialRevealed(did);

        heldRemoveButton.setEnabled(unpublished);
        heldPublishButton.setEnabled(!published);
        heldRevealButton.setEnabled(!revealed);
        heldUnpublishButton.setEnabled(!unpublished);
    }

    private boolean credentialPublished(String did) {
        if (manifest == null || manifest.isEmpty()) {
            return false;
        }
        Object entry = manifest.get(did);
        if (!(entry instanceof java.util.Map<?, ?>)) {
            return false;
        }
        Object credential = ((java.util.Map<?, ?>) entry).get("credential");
        return credential == null;
    }

    private boolean credentialRevealed(String did) {
        if (manifest == null || manifest.isEmpty()) {
            return false;
        }
        Object entry = manifest.get(did);
        if (!(entry instanceof java.util.Map<?, ?>)) {
            return false;
        }
        Object credential = ((java.util.Map<?, ?>) entry).get("credential");
        return credential != null;
    }

    private boolean credentialUnpublished(String did) {
        if (manifest == null || manifest.isEmpty()) {
            return true;
        }
        return !manifest.containsKey(did);
    }

    private boolean isDeactivatedEmptyCredential(String did) {
        try {
            MdipDocument doc = keymasterService.resolveDID(did);
            if (doc == null || doc.didDocumentMetadata == null) {
                return false;
            }
            if (!Boolean.TRUE.equals(doc.didDocumentMetadata.deactivated)) {
                return false;
            }
            Object data = doc.didDocumentData;
            if (data == null) {
                return true;
            }
            if (data instanceof java.util.Map<?, ?>) {
                return ((java.util.Map<?, ?>) data).isEmpty();
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    private void updateSchemaCreateState() {
        String name = schemaNameField.getValue();
        schemaCreateButton.setEnabled(name != null && !name.isBlank());
    }

    private void updateGroupCreateState() {
        String name = groupNameField.getValue();
        groupCreateButton.setEnabled(name != null && !name.isBlank());
    }

    private void updateHeldInputState() {
        String did = heldDidField.getValue();
        boolean hasValue = did != null && !did.isBlank();
        heldResolveFieldButton.setEnabled(hasValue);
        heldDecryptFieldButton.setEnabled(hasValue);
        heldAcceptFieldButton.setEnabled(hasValue);
    }

    private java.util.Map<String, Object> extractManifest(MdipDocument doc) {
        if (doc == null || !(doc.didDocumentData instanceof java.util.Map<?, ?>)) {
            return new java.util.HashMap<>();
        }
        java.util.Map<?, ?> data = (java.util.Map<?, ?>) doc.didDocumentData;
        Object manifestObj = data.get("manifest");
        if (manifestObj instanceof java.util.Map<?, ?>) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> map = (java.util.Map<String, Object>) manifestObj;
            return new java.util.HashMap<>(map);
        }
        return new java.util.HashMap<>();
    }

    private String selectRegistry(List<String> registries, String current) {
        if (current != null && registries.contains(current)) {
            return current;
        }
        for (String registry : registries) {
            if ("hyperswarm".equalsIgnoreCase(registry)) {
                return registry;
            }
        }
        return registries.isEmpty() ? null : registries.get(0);
    }

    private void showError(String message) {
        if (message == null || message.isBlank()) {
            message = "Unexpected error";
        }
        Notification notification = Notification.show(message, 4000, Notification.Position.TOP_END);
        notification.addThemeVariants(NotificationVariant.LUMO_ERROR);
    }

    private void showSuccess(String message) {
        if (message == null || message.isBlank()) {
            message = "Success";
        }
        Notification notification = Notification.show(message, 2500, Notification.Position.TOP_END);
        notification.addThemeVariants(NotificationVariant.LUMO_SUCCESS);
    }
}
