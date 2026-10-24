# 03 — Server

A Linode running **Fedora Server** (1 vCPU / 2 GB RAM is enough with swap). The reader can share the box with
other apps; on a box that is already provisioned (packages, firewall, `tsp` user, SSH), skip to
[04](04-backend.md).

## 1. Create the Linode

Linode → **Create Linode** → image *Fedora* (latest), region close to you, plan *Nanode/Linode 2 GB*. Add
your SSH public key for root. Note the IPv4 address; it goes into the DNS record ([02](02-dns.md)).

## 2. Base system

As root (`ssh root@<ip>`):

```bash
hostnamectl set-hostname <name>
timedatectl set-timezone UTC

# 4 GB swap: the box is small
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo "/swapfile none swap defaults 0 0" >> /etc/fstab

dnf -y upgrade --refresh
dnf -y install dnf-plugins-core httpd mod_ssl certbot fail2ban firewalld git rsync cronie \
    python3.12 nodejs npm dnf5-plugin-automatic policycoreutils-python-utils
systemctl enable --now crond

# Docker CE
dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/fedora/docker-ce.repo
dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
```

Node must be version 20 or newer (`node --version`) to build the frontend.

## 3. Firewall, fail2ban, automatic updates

```bash
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh --add-service=http --add-service=https
firewall-cmd --permanent --remove-service=cockpit --remove-service=dhcpv6-client
firewall-cmd --reload
systemctl disable --now cockpit.socket

printf "[sshd]\nenabled = true\nbackend = systemd\n" > /etc/fail2ban/jail.d/sshd.local
systemctl enable --now fail2ban

# security updates only, never an automatic reboot
printf "[commands]\nupgrade_type = security\napply_updates = yes\nreboot = never\n" > /etc/dnf/automatic.conf
systemctl enable --now dnf5-automatic.timer
```

The database and the API listen on `127.0.0.1` only; the firewall exposes SSH, HTTP and HTTPS.

## 4. SELinux

SELinux stays **enforcing**. Apache must be allowed to connect to the API on localhost:

```bash
setsebool -P httpd_can_network_connect 1
```

The other labels the reader needs (the Python virtualenv, the web root) are set in [04](04-backend.md) and
[06](06-web-app.md).

## 5. The `tsp` user

Everything runs as `tsp`, in the groups `wheel` (sudo) and `docker`:

```bash
useradd -m -s /bin/bash tsp
passwd tsp
usermod -aG wheel,docker tsp
install -d -m 700 -o tsp -g tsp /home/tsp/.ssh
install -m 600 -o tsp -g tsp /root/.ssh/authorized_keys /home/tsp/.ssh/authorized_keys
restorecon -R /home/tsp/.ssh
```

## 6. SSH keys only

```bash
printf "PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n" \
    > /etc/ssh/sshd_config.d/10-keys-only.conf
sshd -t && systemctl reload sshd
```

Check from a second terminal that `ssh tsp@<ip>` still works before closing the root session.
