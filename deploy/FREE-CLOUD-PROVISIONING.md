# Aries Swarm — Free Cloud VM Provisioning Guide

## Quick Deploy (Any VM)
Once you have SSH access to any Linux VM:
```bash
curl -sL https://gateway.doomtrader.com:9700/api/deploy/ollama-worker.sh | sudo bash
```
This installs Node.js, Ollama, pulls the right model for your RAM, and connects to the swarm.

---

## 1. Oracle Cloud (PRIORITY — Best Free Tier)
**FREE FOREVER: 4 ARM cores, 24GB RAM** — can run llama3.2:3b or even 7b!

### Setup Steps:
1. Go to https://cloud.oracle.com and sign up with `your-email@example.com`
2. Choose **Home Region**: `us-ashburn-1` (best availability)
3. After account creation, go to **Compute → Instances → Create Instance**
4. Settings:
   - **Shape**: `VM.Standard.A1.Flex` (ARM)
   - **OCPUs**: 4, **RAM**: 24GB (max free)
   - **Image**: Ubuntu 22.04 (aarch64)
   - **SSH Key**: Paste contents of `~/.ssh/aries-swarm-oci.pub`
   - **Boot volume**: 200GB (free tier includes this)
5. After VM launches, SSH in:
   ```bash
   ssh -i ~/.ssh/aries-swarm-oci ubuntu@<VM-IP>
   curl -sL https://gateway.doomtrader.com:9700/api/deploy/ollama-worker.sh | sudo bash
   ```

### Alternative — Split into multiple VMs:
- 2x VM.Standard.A1.Flex (2 OCPU, 12GB each) — each runs llama3.2:3b
- 2x VM.Standard.E2.1.Micro (1 OCPU, 1GB each) — each runs tinyllama
- Total: 4 free VMs!

### OCI CLI (if installed):
```bash
oci compute instance launch \
  --availability-domain "AD-1" \
  --compartment-id <COMPARTMENT_OCID> \
  --shape "VM.Standard.A1.Flex" \
  --shape-config '{"ocpus":4,"memoryInGBs":24}' \
  --image-id <UBUNTU_ARM_IMAGE_OCID> \
  --ssh-authorized-keys-file ~/.ssh/aries-swarm-oci.pub \
  --display-name "aries-ollama-oracle" \
  --user-data-file deploy/cloud-init-ollama.yaml
```

---

## 2. Google Cloud (GCP) — Already Active
**FREE**: 1x e2-micro in us-central1/us-east1/us-west1

Current: `aries-swarm-1` at YOUR-GCP-IP (e2-micro, us-central1-a)
- Already running relay + ollama workers
- Free tier only allows 1 e2-micro — already used

### If gcloud CLI available:
```bash
gcloud compute ssh aries-swarm-1 --zone=us-central1-a
# Then run the ollama installer on it
```

### SSH Fix (if needed):
The SSH key `aries-swarm` doesn't work. Try:
```bash
gcloud compute ssh aries-swarm-1 --zone=us-central1-a --project=project-74060e11-4758-4154-9df
```

---

## 3. AWS Free Tier
**FREE 12 months**: 1x t2.micro (1 vCPU, 1GB RAM)

### Setup Steps:
1. Go to https://aws.amazon.com and sign up with `your-email@example.com`
2. Launch EC2 instance:
   - **Region**: us-east-1
   - **AMI**: Ubuntu 22.04
   - **Type**: t2.micro
   - **Key pair**: Create new or import `aries-swarm.pub`
   - **Security group**: Allow SSH (22), outbound all
   - **User data**: Paste contents of `deploy/cloud-init-ollama.yaml`
3. SSH in after launch:
   ```bash
   ssh -i ~/.ssh/aries-swarm ubuntu@<EC2-IP>
   ```

### AWS CLI (if available):
```bash
aws ec2 run-instances \
  --image-id ami-0c7217cdde317cfec \
  --instance-type t2.micro \
  --key-name aries-swarm \
  --user-data file://deploy/cloud-init-ollama.yaml \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=aries-ollama-aws}]'
```

---

## 4. Azure Free Tier
**FREE 12 months**: 1x Standard_B1s (1 vCPU, 1GB RAM)

### Setup Steps:
1. Go to https://azure.microsoft.com/free and sign up
2. Create VM:
   - **Size**: Standard_B1s
   - **Image**: Ubuntu 22.04
   - **Region**: East US
   - **SSH Key**: Import aries-swarm.pub
   - **Custom data**: Paste cloud-init-ollama.yaml
3. SSH and run installer

### Azure CLI:
```bash
az vm create \
  --name aries-ollama-azure \
  --resource-group aries-rg \
  --image Ubuntu2204 \
  --size Standard_B1s \
  --ssh-key-values ~/.ssh/aries-swarm.pub \
  --custom-data deploy/cloud-init-ollama.yaml
```

---

## 5. Fly.io
**FREE**: 3x shared-cpu-1x (256MB RAM each)

### Setup:
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login

# Deploy worker as app
flyctl launch --name aries-ollama-fly-1 --region iad --vm-size shared-cpu-1x
```

Note: 256MB is very tight. May only run tinyllama or AI worker worker.

---

## 6. Railway (Already have account)
- DOOMTRADER already deployed on Railway
- Free plan: 500 hours/month, 512MB RAM
- Can deploy a worker as a service
- Use the Railway dashboard or CLI

---

## 7. Render
- Free tier: 750 hours/month for web services
- Deploy worker as a web service with a health endpoint
- Auto-sleeps after 15 min inactivity (needs keep-alive ping)

---

## 8. Hetzner Cloud (Cheapest Paid Option)
- CX22: €3.29/month (2 vCPU, 4GB RAM) — runs llama3.2:1b great
- Not free but extremely cheap for the value

---

## Current Swarm Status
| Provider | Workers | Model | Status |
|----------|---------|-------|--------|
| Local | 14 | N/A | ✅ Active |
| GCP | 4+2 | ollama (relay) | ✅ Active |
| Vultr | 6 | mistral + llama3.2:1b | ✅ Active |
| Oracle | 0 | — | ⏳ Needs signup |
| AWS | 0 | — | ⏳ Needs signup |
| Azure | 0 | — | ⏳ Needs signup |

## Target After Provisioning
| Provider | Workers | Model | RAM |
|----------|---------|-------|-----|
| Oracle (ARM) | 1-4 | llama3.2:3b | 24GB |
| Oracle (micro) | 2 | tinyllama | 1GB each |
| AWS | 1 | tinyllama/llama3.2:1b | 1GB |
| Azure | 1 | tinyllama/llama3.2:1b | 1GB |
| Fly.io | 3 | AI worker | 256MB |
| **Total New** | **8-11** | | |
| **Grand Total** | **28-31** | | |
