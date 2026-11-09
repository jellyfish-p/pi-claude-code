# npm 发布流程

这个项目发布的包名是 `pi-claude-native-tools`。发布包只包含扩展运行所需的文件，目录结构如下：

```text
extensions/claude-native-tools/
  catalog.ts
  index.ts
  replace-all.ts
  translate.ts
  README.md
LICENSE
README.md
package.json
```

## 本地检查

查看 npm 会收进包里的文件：

```bash
npm pack --dry-run
```

运行完整测试并模拟发布：

```bash
npm test
npm publish --dry-run --access public --tag latest
```

## GitHub Actions

发布 workflow 位于 [`.github/workflows/package.yml`](../.github/workflows/package.yml)。

- `main`、`master`、Pull Request 和手动运行会测试并生成 package artifact。
- 推送 `v*.*.*` tag 会额外发布 npm 和创建 GitHub Release。
- 打包 job 使用 Node 22。
- npm 发布 job 使用 Node 24，并下载测试 job 生成的同一份 tarball。
- 发布前会校验包名、版本、tag、Git commit、SHA-256 和 npm integrity。
- 发布完成后，GitHub Release 使用同一个 tarball、校验文件和构建清单。

发布校验逻辑在 [`tools/release.ts`](../tools/release.ts)，对应测试在 [`test/release.test.ts`](../test/release.test.ts)。

## npm Trusted Publisher

当前 workflow 使用 npm Trusted Publisher 和 GitHub Actions OIDC 发布。npm 包设置里的 Trusted Publisher 填写：

| 字段 | 值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `jellyfish-p` |
| Repository | `pi-claude-code` |
| Workflow filename | `package.yml` |
| Environment name | 留空 |

开启直接 `npm publish` 权限后，GitHub Actions 会使用短期 OIDC 凭证完成发布。workflow 已配置 `id-token: write`，仓库里无需保存 `NPM_TOKEN`。

## 发布新版本

先修改 `package.json` 的版本号，提交并推送 `main`，再推送同名 tag：

```bash
git add package.json
git commit -m "release: v0.1.1"
git push origin main

git tag v0.1.1
git push origin v0.1.1
```

版本号和 tag 必须保持对应关系，例如：

```text
package.json: 0.1.1
tag:          v0.1.1
```

每个 npm 版本只发布一次。若 registry 中已经存在同版本，发布脚本会比较完整性值；相同内容可以安全重跑，内容变化需要递增版本号。

## 抓取与文档生成

抓取脚本和文档生成流程保留在 [`scripts/capture/README.md`](../scripts/capture/README.md)。修改 `data/raw` 后，可以重新生成文档：

```bash
node scripts/collect.mjs
node scripts/build-docs.mjs
```
