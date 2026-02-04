# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# 1.5.0 (2026-02-04)



# 1.4.0 (2026-02-04)


### Bug Fixes

* add typings for CommonJS ([#852](https://github.com/KeychainMDIP/kc/issues/852)) ([736f817](https://github.com/KeychainMDIP/kc/commit/736f81727fb9ec09512cfccab486ec3686843e35))
* remove non-types entries from types export ([#891](https://github.com/KeychainMDIP/kc/issues/891)) ([0a42aad](https://github.com/KeychainMDIP/kc/commit/0a42aad175aee3804857d08737f0bbb315353d05))
* resolveDID returns requested DID in docs ([#998](https://github.com/KeychainMDIP/kc/issues/998)) ([b9ee5c2](https://github.com/KeychainMDIP/kc/commit/b9ee5c2fe2cef1823703892d16c1e591323c8bc4))


### Features

* add bitcoin-inscription mainnet mediator ([#1120](https://github.com/KeychainMDIP/kc/issues/1120)) ([a643a02](https://github.com/KeychainMDIP/kc/commit/a643a02a6e12ffd1f9d0823816063073a854a6bd))
* Added canonicalizeJSON ([#873](https://github.com/KeychainMDIP/kc/issues/873)) ([c584499](https://github.com/KeychainMDIP/kc/commit/c584499fe529c37d523347b32ca536ff0083cdb0))
* Added didResolutionMetadata ([#1104](https://github.com/KeychainMDIP/kc/issues/1104)) ([4e831e7](https://github.com/KeychainMDIP/kc/commit/4e831e7825571a57d9afa6a0aee43e475c506481))
* Adds BTC Signet registry ([#823](https://github.com/KeychainMDIP/kc/issues/823)) ([4490198](https://github.com/KeychainMDIP/kc/commit/44901980da2a8f1d2b9f4969f33eb4282c46ce43))
* Adds create ops to registry queue ([#990](https://github.com/KeychainMDIP/kc/issues/990)) ([9f6cfa2](https://github.com/KeychainMDIP/kc/commit/9f6cfa2eab70777dd18a0205ce41116d357a4df1))
* Adds custom headers to GatekeeperClient ([#993](https://github.com/KeychainMDIP/kc/issues/993)) ([fea7789](https://github.com/KeychainMDIP/kc/commit/fea778920ed978a424c45d5ee2cd8583c75fabcf))
* Adds timestamps to DID metadata ([#786](https://github.com/KeychainMDIP/kc/issues/786)) ([3a6dc7a](https://github.com/KeychainMDIP/kc/commit/3a6dc7aa067792123f0f0fcf22e7b79191404807))
* implement CJS and ESM dual build in packages ([#831](https://github.com/KeychainMDIP/kc/issues/831)) ([1488744](https://github.com/KeychainMDIP/kc/commit/1488744146f4f6bef0b23a5a649ad0af2011a99d))



# 1.1.0 (2025-05-02)


### Bug Fixes

* Add registry queue size limit ([#608](https://github.com/KeychainMDIP/kc/issues/608)) ([9fcf252](https://github.com/KeychainMDIP/kc/commit/9fcf25293794ef9243350912ec1dc367bf5f16b8))
* Added op size test to import ([#595](https://github.com/KeychainMDIP/kc/issues/595)) ([607ec09](https://github.com/KeychainMDIP/kc/commit/607ec096efea740a709b5682967df5cf0007338f))
* gatekeeper.start() handles multiple calls ([#485](https://github.com/KeychainMDIP/kc/issues/485)) ([32d3cb5](https://github.com/KeychainMDIP/kc/commit/32d3cb593ce76cf29ef5883e6870aa7459d74f47))
* Generate canonicalid metadata ([#540](https://github.com/KeychainMDIP/kc/issues/540)) ([29736f6](https://github.com/KeychainMDIP/kc/commit/29736f665f8f7ac12612e70b634e92c9f5b18494))
* Improve batch import tracking ([#405](https://github.com/KeychainMDIP/kc/issues/405)) ([350b479](https://github.com/KeychainMDIP/kc/commit/350b4790dad918785eb08f9d28c9a0a4f32f3eb5))
* improve verifyDb ([#388](https://github.com/KeychainMDIP/kc/issues/388)) ([b404e7d](https://github.com/KeychainMDIP/kc/commit/b404e7d6a5f48ae8e22d0cb92e4b32cdda6e7cab))
* Keymaster service now creates node ID ([#772](https://github.com/KeychainMDIP/kc/issues/772)) ([418118c](https://github.com/KeychainMDIP/kc/commit/418118c6d59afd4115fe62aa73f52f47ebe98dec))
* mongodb queueOperation ([#621](https://github.com/KeychainMDIP/kc/issues/621)) ([3846fe1](https://github.com/KeychainMDIP/kc/commit/3846fe11969d60eb452bea68dd8447948f7e698f))
* Node sync with mongodb ([#442](https://github.com/KeychainMDIP/kc/issues/442)) ([f0a42e2](https://github.com/KeychainMDIP/kc/commit/f0a42e264323149843b5ffad34c666ba4243a26b))
* Node sync with sqlite ([#445](https://github.com/KeychainMDIP/kc/issues/445)) ([0ca9f1b](https://github.com/KeychainMDIP/kc/commit/0ca9f1b194568c0028579aac9d9a0946a2bc0535))
* Prevent DID creation on unsupported registry ([#537](https://github.com/KeychainMDIP/kc/issues/537)) ([c72361c](https://github.com/KeychainMDIP/kc/commit/c72361ca408f79b85fbf3efc6267c59fac2820a7))
* Reject bad DIDs in importEvent ([#616](https://github.com/KeychainMDIP/kc/issues/616)) ([d0ca77b](https://github.com/KeychainMDIP/kc/commit/d0ca77b92b8320c7018cb7abb03977e1cb74c263))
* Reset corrupted json db files ([#458](https://github.com/KeychainMDIP/kc/issues/458)) ([70d7083](https://github.com/KeychainMDIP/kc/commit/70d70838e78bba9b73b422ed236c35bc4e7eae01))
* response DIDs should be ephemeral ([#340](https://github.com/KeychainMDIP/kc/issues/340)) ([5eadb49](https://github.com/KeychainMDIP/kc/commit/5eadb49135739d5e05e4768c326a015afe2dc7d1))
* Revert overwriting id ([#572](https://github.com/KeychainMDIP/kc/issues/572)) ([80441cd](https://github.com/KeychainMDIP/kc/commit/80441cd838df6579ad4bbbe99e26361feaa86f55))
* satoshi-mediator scans for all valid MDIP DIDs ([#603](https://github.com/KeychainMDIP/kc/issues/603)) ([a3454ed](https://github.com/KeychainMDIP/kc/commit/a3454edb333f6d11be5834bd6cda62cb71691703))
* Update versions for current ID ([#544](https://github.com/KeychainMDIP/kc/issues/544)) ([7a175f2](https://github.com/KeychainMDIP/kc/commit/7a175f2fb9a5e65575b78deb5d314c04730da1be))


### Code Refactoring

* keymaster API ([#533](https://github.com/KeychainMDIP/kc/issues/533)) ([6be419b](https://github.com/KeychainMDIP/kc/commit/6be419bb4ef4437d1b0773e612b1ebce50ac7490))


### Features

* add DID list to extension ([#561](https://github.com/KeychainMDIP/kc/issues/561)) ([4193ac0](https://github.com/KeychainMDIP/kc/commit/4193ac00df1fdda6209437f9b71ee334966a27dd))
* add explorer to services folder ([#760](https://github.com/KeychainMDIP/kc/issues/760)) ([d0e215b](https://github.com/KeychainMDIP/kc/commit/d0e215b2bedb295b355b6fecc70085f8963c8b7f))
* Add image assets to keymaster ([#699](https://github.com/KeychainMDIP/kc/issues/699)) ([304b159](https://github.com/KeychainMDIP/kc/commit/304b1598b9c243a3503bb5389db9947bfb2fb0c3))
* Add redis support for gatekeeper ([#369](https://github.com/KeychainMDIP/kc/issues/369)) ([76b5ef4](https://github.com/KeychainMDIP/kc/commit/76b5ef43f38a0512fd9c534fef2e87bf8efd0262))
* add update, delete to POST /did endpoint ([#628](https://github.com/KeychainMDIP/kc/issues/628)) ([bc369bd](https://github.com/KeychainMDIP/kc/commit/bc369bdc21d844d0f992a9470518bf4a83373d1e))
* Added db and versions to status ([#497](https://github.com/KeychainMDIP/kc/issues/497)) ([03c4599](https://github.com/KeychainMDIP/kc/commit/03c4599c58cb36391c366e0bdb154b3f3970ddb6))
* Added events queue to server status ([#598](https://github.com/KeychainMDIP/kc/issues/598)) ([406fe9c](https://github.com/KeychainMDIP/kc/commit/406fe9c85457d38f8ebb4148db975855f61772ac))
* Added gatekeeper status ([#491](https://github.com/KeychainMDIP/kc/issues/491)) ([ffbe989](https://github.com/KeychainMDIP/kc/commit/ffbe9892b07be91825a28c59a7f76a0e7d0ffa7a))
* Added gatekeeper status interval to config ([#500](https://github.com/KeychainMDIP/kc/issues/500)) ([4dc6fb5](https://github.com/KeychainMDIP/kc/commit/4dc6fb5ca46487b75d7a8d3cbbdb0e27caa05fab))
* Added includeHash option to encryptMessage ([#450](https://github.com/KeychainMDIP/kc/issues/450)) ([26e0048](https://github.com/KeychainMDIP/kc/commit/26e00486fcb164af6780beca8dd914b0ef9d9c1c))
* Added KC_MDIP_PROTOCOL to config ([#489](https://github.com/KeychainMDIP/kc/issues/489)) ([e0da84e](https://github.com/KeychainMDIP/kc/commit/e0da84e8b421fa2112352bbb7857c491fb2006c6))
* Added npm packages ([#323](https://github.com/KeychainMDIP/kc/issues/323)) ([0c97b0e](https://github.com/KeychainMDIP/kc/commit/0c97b0ece69000263aebfa73a1dca3b4403f18d0))
* Added operation size limit ([#588](https://github.com/KeychainMDIP/kc/issues/588)) ([c33fcbc](https://github.com/KeychainMDIP/kc/commit/c33fcbc92e2cc20f93b730fb93cbcf719a2ac268))
* Added versionId to metadata ([#527](https://github.com/KeychainMDIP/kc/issues/527)) ([d715502](https://github.com/KeychainMDIP/kc/commit/d715502f95977b20da8b09bf48f74700280c82d2))
* Adds CAS (IPFS) support to Gatekeeper service ([#696](https://github.com/KeychainMDIP/kc/issues/696)) ([e3408bd](https://github.com/KeychainMDIP/kc/commit/e3408bd62834948a79aa6788211718fe1c1bd1b5))
* Adds IPFS package and service ([#398](https://github.com/KeychainMDIP/kc/issues/398)) ([e12f4d5](https://github.com/KeychainMDIP/kc/commit/e12f4d56610926261df6e91fd63a1443a88a7219))
* Chrome browser extension ([#524](https://github.com/KeychainMDIP/kc/issues/524)) ([32c2727](https://github.com/KeychainMDIP/kc/commit/32c2727b8a91555273768bf20eafcb7a2b8e5f37))
* Chrome extension add image and rename DID support ([#734](https://github.com/KeychainMDIP/kc/issues/734)) ([96ccd51](https://github.com/KeychainMDIP/kc/commit/96ccd5123da92b4e4ddf2b8bbd72f302efc0b461))
* convert Cipher and common libs to TypeScript ([#680](https://github.com/KeychainMDIP/kc/issues/680)) ([1af22d0](https://github.com/KeychainMDIP/kc/commit/1af22d07770388d6f4f613fac4eecf37a6f4c6b8))
* convert Gatekeeper DB libs to TypeScript ([#678](https://github.com/KeychainMDIP/kc/issues/678)) ([f34c62a](https://github.com/KeychainMDIP/kc/commit/f34c62a8ddcaaab97fb8d13fcd1c12aabe088682))
* convert Gatekeeper lib to TypeScript ([#689](https://github.com/KeychainMDIP/kc/issues/689)) ([f78b299](https://github.com/KeychainMDIP/kc/commit/f78b2999e98890b968d0567ba09d47e08d159a18))
* convert GatekeeperClient to TypeScript ([#691](https://github.com/KeychainMDIP/kc/issues/691)) ([5ceaf09](https://github.com/KeychainMDIP/kc/commit/5ceaf0910e549f14bb931f72aa5e40658bdf9fa9))
* convert Keymaster to TypeScript ([#709](https://github.com/KeychainMDIP/kc/issues/709)) ([8381e89](https://github.com/KeychainMDIP/kc/commit/8381e89f7ca7275df89da04a4962d80acf5e642d))
* convert keymaster-api and getkeeper-api to TypeScript ([#720](https://github.com/KeychainMDIP/kc/issues/720)) ([ceee7fe](https://github.com/KeychainMDIP/kc/commit/ceee7fe735a6d5d160dedf881cac0b696d15eb63))
* publish [@mdip](https://github.com/mdip) packages ([#327](https://github.com/KeychainMDIP/kc/issues/327)) ([493161c](https://github.com/KeychainMDIP/kc/commit/493161c05f777defd92278d35443b402e46a571f))
* Re-enable hash check on operations ([#463](https://github.com/KeychainMDIP/kc/issues/463)) ([9159d7a](https://github.com/KeychainMDIP/kc/commit/9159d7a0631c039cce09f558ae2a52de27baff1f))


### BREAKING CHANGES

* keymaster /names/:name now returns DID instead of resolving to docs
