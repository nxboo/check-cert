# 证书过期检测工具

这是一个命令行工具，用于检查指定域名及其 DNS 记录中所有关联域名的 HTTPS 证书过期时间。

## 功能特性

- ✅ **自动解析 DNS 记录** - 支持 DNSPod 导出的 CSV 格式
- ✅ **多层 CNAME 递归解析** - 自动跟踪 CNAME 链找到最终的 A 记录
- ✅ **外部服务支持** - 正确处理指向 CDN、云存储等外部服务的 CNAME
- ✅ **实时输出** - 逐条输出检测结果，支持并发检测（默认 5 个并发连接）
- ✅ **多IP支持** - 同一域名有多个 A 记录时，为每个 IP 分别检测
- ✅ **防循环引用** - 自动检测并防止 CNAME 循环
- ✅ **中文状态标签** - 清晰的中文状态标签便于理解

## 安装

```bash
  npm install -g @nxboo/check-cert
```

# 全局安装

# 使用
```bash
# 使用 DNS 记录文件检测
node index.js example.com dnspod_export.csv

# 自定义过期警告天数（默认 30 天）
node index.js example.com dnspod_export.csv 15
```
```bash
# 克隆或下载项目
cd check-cert

# 无需额外依赖，使用 Node.js 内置模块
node index.js --help
```

## DNS 文件格式

支持 DNSPod 导出的 CSV 文件格式（Tab 分割）：

```csv
主机|类型|线路|记录值|MX优先级|权重|TTL|备注|状态|最后操作时间
www	CNAME	默认	aliapp.example.com.	0	-	60		正常	2022-12-01 15:21:46
test1	A	默认	192.168.1.1	0	-	600		正常	2020-11-25 17:26:39
```

## 输出格式

CSV 格式输出，包含以下字段：

```
hostname,type,ip,status,expiry_date
```

- **hostname**: 主机名
- **type**: 记录类型（A、CNAME、main）
- **ip**: IP 地址或目标域名
- **status**: 证书状态
- **expiry_date**: 证书过期日期

### 示例输出

```
hostname,type,ip,status,expiry_date
www,CNAME,192.168.1.1,正常,2027-03-31
test1,A,192.168.1.1,即将过期,2026-09-19
test1,CNAME,test1-idvdg90.qiniudns.com,即将过期,2026-09-19
api,A,192.168.1.1,无法访问,N/A
```

## 证书状态说明

| 状态            | 含义     | 说明                                 |
| --------------- | -------- | ------------------------------------ |
| 🟢 **正常**     | 证书有效 | 证书有效期超过设定天数（默认 30 天） |
| 🟡 **即将过期** | 即将过期 | 证书将在设定天数内（默认 30 天）过期 |
| 🔴 **已过期**   | 已过期   | 证书已经过期                         |
| ⚫ **无法访问** | 连接失败 | 无法建立连接或获取证书信息           |

## CNAME 处理逻辑

### 本地 CNAME 链

工具会自动递归解析本地域名内的 CNAME 链，找到最终的 A 记录：

```
www (CNAME)
  └─> test1 (CNAME)
       └─> test2 (CNAME)
            └─> test3 (A record: 192.168.1.1)
```

最终输出：`www,CNAME,192.168.1.1,正常,2027-03-31`

### 外部 CNAME

对于指向外部服务的 CNAME（如 CDN），工具会保留原始指向并使用正确的 SNI（Server Name Indication）进行检测：

```txt
www,CNAME,www.example.com.w.kunlungr.com,正常,2027-03-31
  (连接到 CDN 域名，但使用 sd.example.com 作为 SNI)
```

### 多 IP 支持

同一域名有多个 A 记录时，工具会为每个 IP 分别检测：

```txt
www,CNAME,192.168.1.1,正常,2027-03-31
www,CNAME,192.168.1.2,正常,2027-03-31
www,CNAME,192.168.1.3,正常,2027-03-31
```

## 配置选项

### 超时设置

- 连接超时：3000 毫秒（可在代码中修改 `TIMEOUT` 常量）
- 并发连接数：5（可在代码中修改 `MAX_CONCURRENT` 常量）

## 常见问题

### Q: 为什么某些 CDN 域名显示"无法访问"？

**A**: 这通常意味着：

1. CDN 服务未提供 HTTPS
2. CDN 节点临时不可用
3. 网络连接问题

建议确认该服务是否确实提供 HTTPS 支持。

### Q: CNAME 显示的 IP 与 nslookup 结果不同？

**A**: 工具会递归解析 CNAME 链找到最终的 A 记录 IP，这是正确的行为。DNS 查询可能会返回其他结果。

### Q: 如何批量处理多个域名？

**A**: 可以编写脚本循环调用：

```bash
for domain in example.com test.com; do
  echo "=== $domain ==="
  node index.js $domain dnspod_$domain.txt 30
done
```

## 实现细节

- **语言**: Node.js (JavaScript)
- **依赖**: 仅使用 Node.js 内置模块（fs、https）
- **并发模式**: 使用 Promise 实现的并发控制
- **SNI 处理**: 正确设置 TLS Server Name Indication，支持虚拟主机上的多证书
- **防循环**: 在 CNAME 链解析中使用 Set 追踪已访问的主机，防止无限循环

## 输出示例

```bash
$ node index.js example.com dnspod_example.com.txt 30

hostname,type,ip,status,expiry_date
www,CNAME,192.168.1.1,正常,2027-03-31
test1,A,192.168.1.1,正常,2027-03-31
test2,A,192.168.1.1,即将过期,2026-09-19
test3,CNAME,sd.example.com.w.kunlungr.com,正常,2027-03-31
test4,A,192.168.1.1,无法访问,N/A
```
