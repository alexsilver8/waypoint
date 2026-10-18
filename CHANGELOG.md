# Changelog

Every release of Waypoint. `pnpm release` writes it from the commits, and each GitHub release shows its section.

## 0.2.0 (2026-10-18)

3 features.

### Features

- **snippets:** expand keywords as you type in any app ([#52](https://github.com/alexsilver8/waypoint/pull/52), [54b6a6a](https://github.com/alexsilver8/waypoint/commit/54b6a6a7fcf139d5ebbc93804e09f666f6be4cf4))
- update from GitHub releases with electron-updater ([#51](https://github.com/alexsilver8/waypoint/pull/51), [7dedd8d](https://github.com/alexsilver8/waypoint/commit/7dedd8dce531067eeb0f2ec86f12ffa2432721d1))
- **api:** publish as @waypoint-org/api ([#49](https://github.com/alexsilver8/waypoint/pull/49), [d5be1fd](https://github.com/alexsilver8/waypoint/commit/d5be1fd09f452aeedff092fa97517b4b36693183))

### Other changes

- take what's done off the website's roadmap ([#50](https://github.com/alexsilver8/waypoint/pull/50), [33cfc94](https://github.com/alexsilver8/waypoint/commit/33cfc94d1e536326c870153c704904726e6d1e4f))

## 0.1.0 (2026-10-18)

23 features and 23 fixes.

### Features

- add @waypoint/api, a package of types and helpers for extensions ([72f2bce](https://github.com/alexsilver8/waypoint/commit/72f2bce02d9ae80050ee94825b6c107c7a4f7899))
- create and edit quicklinks and snippets in the launcher ([a3f480f](https://github.com/alexsilver8/waypoint/commit/a3f480fbd17214289312dc92829fec7ad139e7e8))
- add quicklinks and snippets ([50a085a](https://github.com/alexsilver8/waypoint/commit/50a085a96031a3b614f5bfd5a489235741b8a78f))
- show pages of markdown and forms from extensions ([2af156e](https://github.com/alexsilver8/waypoint/commit/2af156ef9b99615fce3ca8a6d3922fa6170983db))
- give any command its own global shortcut ([83a0ea0](https://github.com/alexsilver8/waypoint/commit/83a0ea069f360d06c84505bfa2b8e9bc035e2ce3))
- open at login on linux, through xdg autostart ([94b850a](https://github.com/alexsilver8/waypoint/commit/94b850ad0ffb3309022a9803fc898c3cdaf6ae7f))
- **notes:** make the format bar look and work like Raycast's ([0fc57ea](https://github.com/alexsilver8/waypoint/commit/0fc57ea37e269dc355231d1abe1abcdc91e4a21c))
- go home with Esc, and close the launcher with it from there ([d2be156](https://github.com/alexsilver8/waypoint/commit/d2be1563854c6f24dd0e209ead4d0c427bc2691d))
- show the Settings shortcut on the dock's gear ([3806d41](https://github.com/alexsilver8/waypoint/commit/3806d41c2787d6090a50d243a95bb667c97f740f))
- add Disk Usage, Largest Files, and Archives and Installers ([95746a7](https://github.com/alexsilver8/waypoint/commit/95746a7b87061f2a175c57d3ad27f34d72db52a1))
- let a list fill in while it loads, and show changes on the way back ([2b14c74](https://github.com/alexsilver8/waypoint/commit/2b14c74e6d05c5e7c6b5b1020e42f54e41471d99))
- let extensions keep the computer awake through Waypoint, and use it on Windows ([3d2856f](https://github.com/alexsilver8/waypoint/commit/3d2856f3db5b955914848029755cad8ef92e6fa3))
- walk through setup the first time Waypoint starts ([523a88b](https://github.com/alexsilver8/waypoint/commit/523a88bb5ccb097c72cda2159e82dc117f7934e4))
- add Translate with DeepL, and Define Word ([9dfc80e](https://github.com/alexsilver8/waypoint/commit/9dfc80ef4f4a3b74b39a81d764087af732ec00eb))
- add Keep Awake, Toggle Keep Awake and Allow Sleep ([0049acd](https://github.com/alexsilver8/waypoint/commit/0049acd4bdc5b2320f2ad7ff542088642937adb8))
- add Run Shortcut on macOS ([d3895bf](https://github.com/alexsilver8/waypoint/commit/d3895bf7da366177d37e903f81bedbc18c2981d6))
- add script commands, reading Raycast's headers too ([c7d0f96](https://github.com/alexsilver8/waypoint/commit/c7d0f960bf544c4b286b8a8df3424c0b118888e8))
- add Search Bookmarks for Chrome, Brave, Edge, Vivaldi and Chromium ([e5203ee](https://github.com/alexsilver8/waypoint/commit/e5203ee5f17e2a3cfa9c15d2f0500a0f0a432fb3))
- add Search Files, Search Downloads and Open Latest Download ([5da9292](https://github.com/alexsilver8/waypoint/commit/5da9292fcdce5ca013063efbd8d390b309ed98db))
- **notes:** open popovers in a window of their own, like Raycast ([a446847](https://github.com/alexsilver8/waypoint/commit/a446847f19d969e9a4db87a28987200857c3d986))
- **notes:** make the Notes window work like Raycast Notes ([#48](https://github.com/alexsilver8/waypoint/pull/48), [85115f8](https://github.com/alexsilver8/waypoint/commit/85115f8fbf2fd265a21c448af9d7924a78e89829))
- snap the launcher to guide lines, and float Settings like the launcher ([#47](https://github.com/alexsilver8/waypoint/pull/47), [7b5cfda](https://github.com/alexsilver8/waypoint/commit/7b5cfdac1fbf779d5c93fed1eba96db67db726f4))
- drag the launcher anywhere, with its panes floating free ([#46](https://github.com/alexsilver8/waypoint/pull/46), [886c039](https://github.com/alexsilver8/waypoint/commit/886c039a6ad364ede102d1f26ea0a73489d1c268))

### Fixes

- **disk-usage:** say cloud storage isn't counted in a folder's preview ([ad2cfb9](https://github.com/alexsilver8/waypoint/commit/ad2cfb9f929248ba38f5cd0d9a2e00edadc4acce))
- keep the keyboard in the field clicked after a placeholder ([651dde4](https://github.com/alexsilver8/waypoint/commit/651dde49299e989337161d3d257311b1bb2022b6))
- stop the list running away when the pointer rests on it ([9628be0](https://github.com/alexsilver8/waypoint/commit/9628be00fa39e7bccf5aee0e2a414808abd6162a))
- keep Set Shortcut… off ⌘↵ ([30a0c8a](https://github.com/alexsilver8/waypoint/commit/30a0c8a4267ea0cf0988f34b7b57195d83f5362e))
- let the text of a page be selected and copied ([357bae5](https://github.com/alexsilver8/waypoint/commit/357bae52b75b65bcdadc470d69d8e852286a43b2))
- go back from pages and forms opened with text ([c89745e](https://github.com/alexsilver8/waypoint/commit/c89745ee95ba964076d245814b6947ff56574978))
- keep a page an action pushed when it says it's loading ([e6a2bf9](https://github.com/alexsilver8/waypoint/commit/e6a2bf97974e358128075a8ea06f4454a2aff3d0))
- keep markdown pages quick to draw however they're written ([2205f78](https://github.com/alexsilver8/waypoint/commit/2205f787e1b31cbcd9e85d922242ad77efade150))
- make waypoint:// command links harder to slip past ([fd11c9c](https://github.com/alexsilver8/waypoint/commit/fd11c9c3c40461c294449305cdb14df23e8a831c))
- open only web and mail links from extension markdown ([2d1a1df](https://github.com/alexsilver8/waypoint/commit/2d1a1df2e61732750756635ec81bd10630c65cec))
- keep markdown images from reaching file shares ([c925cc2](https://github.com/alexsilver8/waypoint/commit/c925cc2a0ec75884399e008fee57a4797707d575))
- keep the keys typed before the launcher catches up ([e3d17be](https://github.com/alexsilver8/waypoint/commit/e3d17be7bf449836eee90a65461ab17a29b96d10))
- keep one snippet's bad date from hiding all of them ([895d774](https://github.com/alexsilver8/waypoint/commit/895d774b13171381221b2a586910db36fd6186f7))
- never lose quicklinks and snippets written by hand ([42c9da1](https://github.com/alexsilver8/waypoint/commit/42c9da126824e5ac7832a523c41b3da04e7fcfd9))
- keep what a quicklink fills in from becoming extra arguments ([27c52c2](https://github.com/alexsilver8/waypoint/commit/27c52c28d789227cd05e27d57c2594c184f84095))
- ask before deleting what's too big for the Recycle Bin ([a0e97aa](https://github.com/alexsilver8/waypoint/commit/a0e97aa002ab5a0850597e8df6cf3ca164618253))
- wrap long values in the preview instead of scrolling it sideways ([ddc04a4](https://github.com/alexsilver8/waypoint/commit/ddc04a4edd161af3d51266897d50a99a136d497b))
- let Enter carry on after recording a shortcut in setup ([a44eb98](https://github.com/alexsilver8/waypoint/commit/a44eb9800557318f783a250cd841147ebdc33718))
- start Keep Awake within the extension host's time ([d9d0ed2](https://github.com/alexsilver8/waypoint/commit/d9d0ed2c95b633eb17b5fb6ec47f37ca0a8616b5))
- list Downloads afresh after a trash, and search with older fd and es ([757c29e](https://github.com/alexsilver8/waypoint/commit/757c29ed3254cedf8f44cb8de5b36443d133252c))
- hand batch files their arguments as typed ([e74ba02](https://github.com/alexsilver8/waypoint/commit/e74ba021b78975b422f1154f3ad43d4fc2e3c59a))
- start PowerShell attached on Windows, where a detached one exits at once ([2ccd4c7](https://github.com/alexsilver8/waypoint/commit/2ccd4c7464507fc09e9ae94ad033baf48b484da5))
- stop the picked scope's icon vanishing when nothing matches ([3bfdafd](https://github.com/alexsilver8/waypoint/commit/3bfdafdd5514ae596de75d8b7ae0ffe2e87fe814))

### Other changes

- save a quicklinks edit again until a busy Mac sees it ([1000f24](https://github.com/alexsilver8/waypoint/commit/1000f248f478f9cb3e2a63b7be1dfa350901027c))
- run the unit tests on macOS too ([c9d6d5c](https://github.com/alexsilver8/waypoint/commit/c9d6d5c040564589b8f431298d5e4624bdb3ccfd))
- expect the order macOS gives Downloads ([c331799](https://github.com/alexsilver8/waypoint/commit/c33179956a366898cc90abb6bad63faba7cd9577))
- start the changelog again from the first 0.x release ([60ea158](https://github.com/alexsilver8/waypoint/commit/60ea1589193870c18dd2ff40bcae4d405d87c294))
- wait for setup to show its first step before pressing keys ([9c71bd6](https://github.com/alexsilver8/waypoint/commit/9c71bd6f6bc407191b7dde34b5b0399dadbcae71))
- take what's done off the roadmap ([477d0a9](https://github.com/alexsilver8/waypoint/commit/477d0a9dc9a62060e6cd6fc39a475c5802da86a7))
- wait for the quicklink form to close before checking the search ([0ba1bdc](https://github.com/alexsilver8/waypoint/commit/0ba1bdc7dc51d9171000dda3f4a104433cac89fd))
- wait for the extension's command before opening it ([5bd498c](https://github.com/alexsilver8/waypoint/commit/5bd498c4830826f922cba9649b73cd79af84b2a8))
- have the disk usage smoke test scan the folder it types ([bc07b95](https://github.com/alexsilver8/waypoint/commit/bc07b955f987dc954c89f236f6b7356065e0038f))
- add the seven new extensions to the website's Included cards ([08b8830](https://github.com/alexsilver8/waypoint/commit/08b88306d0cb6e513d57c19e96b712bb4bea159d))
- describe the new extensions, and how to write a script command ([433601c](https://github.com/alexsilver8/waypoint/commit/433601c92f50a3c49d2c2965a60154919a7913ec))
- show the bundled extensions as cards in Included ([75ead1c](https://github.com/alexsilver8/waypoint/commit/75ead1c1ce194cc26180e51ebaf66e7aa7dd6f96))
- reset the version to 0.0.1 until the 1.0.0 launch ([881d8a5](https://github.com/alexsilver8/waypoint/commit/881d8a56de7874eb9613d35267131afcd7b55c72))
- retitle the bento and show five rows of included commands ([8fa2b44](https://github.com/alexsilver8/waypoint/commit/8fa2b44f92ae6f1718896008208161d5a1a827bb))
- **e2e:** run one app at a time ([10fa0e6](https://github.com/alexsilver8/waypoint/commit/10fa0e6236e753042e48a51185bf858c23b34a86))
- redraw the landing page for the Halo launcher and the new Notes window ([032e750](https://github.com/alexsilver8/waypoint/commit/032e75014676442444abb32714448a6dcbac14d3))
