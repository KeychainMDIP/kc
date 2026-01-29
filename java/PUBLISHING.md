# Java Publishing (Maven Central)

This doc describes how to publish the Java modules in `java/` to Maven Central under the `com.selfid` groupId using the **Sonatype Central Portal** flow.

## Modules

- `cid`
- `crypto`
- `gatekeeper`
- `keymaster`

## Prerequisites

1. Sonatype account with the **com.selfid** namespace verified (Central Portal).
2. A GPG signing key (ASCII-armored) for signing artifacts.
3. Access to **Central Portal**: https://central.sonatype.com/

## Configuration

Publishing is configured in `java/build.gradle` and `java/gradle.properties`.

- Group + version are set in `java/gradle.properties`.
  - Example: `group=com.selfid`, `version=1.0.0`
- POM metadata is defined in `java/build.gradle` (name, description, SCM, licenses, developers).

## Secrets (Environment Variables)

Set these before publishing:

- `SONATYPE_USERNAME` (Central Portal **User Token** username)
- `SONATYPE_PASSWORD` (Central Portal **User Token** password)
- `SIGNING_KEY` (ASCII-armored private key text)
- `SIGNING_PASSWORD`

Optional:

- `CENTRAL_PUBLISHING_TYPE` (default: `USER_MANAGED`)
- `CENTRAL_DEPLOYMENT_NAME` (default: `Self ID Java <version>`)

Example:

```bash
export SONATYPE_USERNAME=your_token_username
export SONATYPE_PASSWORD=your_token_password
export SIGNING_KEY="$(cat /path/to/privatekey.asc)"
export SIGNING_PASSWORD=your_key_password
```

## Build and Publish (Central Portal)

From `java/`:

```bash
./gradlew clean
./gradlew publishCentral
```

This will:

1. Publish all subprojects into a local **central bundle** directory
2. Generate required checksum files
3. Zip the bundle
4. Upload it to Central Portal

### Publish a Single Module (bundle only)

```bash
./gradlew :cid:publishMavenJavaPublicationToCentralBundleRepository
```

To upload the full bundle after that, still run:

```bash
./gradlew uploadCentralBundle
```

## Release in Central Portal

After upload, log into Central Portal and follow the deployment status. If `CENTRAL_PUBLISHING_TYPE` is `USER_MANAGED`, you will need to manually release the deployment there.

