# 02 — DNS (Namecheap)

`apicov.xyz` is registered at Namecheap and uses Namecheap's own nameservers (`dns1/dns2.registrar-servers.com`).
The reader needs one record; Cloudflare is not involved (R2 is reached through signed links, not a custom
domain).

Namecheap → **Domain List** → `apicov.xyz` → **Manage** → **Advanced DNS** → **Add New Record**:

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `books` | `172.104.159.186` (the server) | Automatic |

The host is only `books`, not the full name. Save it with the green tick.

Before asking for a certificate ([05](05-apache-https.md)), check the name resolves at Namecheap and at a
public resolver:

```bash
dig +short @dns1.registrar-servers.com books.apicov.xyz A
dig +short @1.1.1.1 books.apicov.xyz A
```

Both must print the server's address. Resolvers remember a "no such name" answer for up to an hour (the
zone's negative TTL), so ask for the certificate only once the record is visible everywhere.
