# 🤝 Contributing to ErrorLens

Thank you for contributing to ErrorLens! We welcome new troubleshooting runbooks, edge performance optimizations, and documentation improvements.

---

## 📖 How to Add a New Troubleshooting Runbook

Adding a runbook takes under 5 minutes:

### 1. Create a New Markdown File
Inside `datasets/runbooks/`, create `<your-error-slug>.md` (e.g. `datasets/runbooks/aws-s3-access-denied.md`).

### 2. Format with Frontmatter & Sections
```markdown
---
slug: aws-s3-access-denied-403
category: cloud
error_code: S3 403 Access Denied
title: AWS S3 Access Denied (HTTP 403 Forbidden)
tags: [aws, s3, iam, permissions, 403, cloud]
source_url: https://docs.aws.amazon.com/AmazonS3/latest/userguide/troubleshoot-403-errors.html
---

# AWS S3 Access Denied (HTTP 403 Forbidden)

## Summary
The requesting IAM identity, API key, or presigned URL does not have sufficient permissions in IAM policy, Bucket Policy, or S3 Block Public Access settings.

## Root Cause
S3 enforces permission boundaries across four layers: IAM Identity Policy, Resource Bucket Policy, S3 Block Public Access, and KMS Key Policy (if encrypted). Deny in any layer overrides all allows.

## Diagnostic Command
```bash
aws s3api get-bucket-policy --bucket <your-bucket-name> && aws sts get-caller-identity
```

## Triage Steps
1. **Verify Caller Identity**: Run `aws sts get-caller-identity` to confirm the ARN and account ID making the request.
2. **Test Specific Action with Dry Run**: Run `aws s3 cp test.txt s3://<bucket-name>/test.txt --dryrun` to isolate read vs write failure.
3. **Check Bucket Policy**: Inspect `aws s3api get-bucket-policy` for explicit Deny statements.
4. **Check KMS Key Access**: If S3 bucket uses AWS KMS encryption (SSE-KMS), ensure caller has `kms:Decrypt` and `kms:GenerateDataKey`.
```

### 3. Validate & Compile
Run the parser script:
```bash
node datasets/scripts/ingest.js
```
This updates `datasets/generated_seed.sql`.

### 4. Submit Your Pull Request
1. Fork the repo and create your branch: `git checkout -b runbook/aws-s3-403`.
2. Commit your changes: `git commit -m "feat(runbook): add AWS S3 403 Access Denied"`.
3. Push to your branch and open a PR!
