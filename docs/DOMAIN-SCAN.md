When scanning a website's SSL/TLS certificate for security, the goal is to move beyond just checking if "the lock icon is there." You need to verify the **validity of the identity**, the **strength of the math**, and the **correctness of the server configuration**.

Here are the key security elements you should scan for:

---

## 1. Certificate Identity & Validity
This checks if the "ID card" presented by the server is authentic and current.

* **Expiration Date:** Verify the certificate is not expired. Modern standards are moving toward shorter lifespans (some browsers now prefer 90-day or even 47-day limits).
* **Hostname Mismatch:** Ensure the **Common Name (CN)** or **Subject Alternative Names (SAN)** exactly match the domain you are visiting.
* **Revocation Status:** Check if the certificate has been revoked by the CA before its expiration (using **OCSP** or **CRL**). A revoked certificate usually means the private key was compromised.
* **Trust Chain:** Ensure the certificate is signed by a trusted **Root Certificate Authority (CA)** and that all intermediate certificates are provided. An "incomplete chain" is a common misconfiguration that breaks mobile or older browser connections.

## 2. Cryptographic Strength
Even a valid certificate is useless if the underlying encryption is weak enough to be "cracked."

* **Public Key Size:** * **RSA:** Should be at least **2048-bit** (4096-bit is preferred for high security).
    * **ECDSA:** Should be at least **256-bit**.
* **Signature Algorithm:** Avoid certificates signed with **SHA-1** or **MD5**, which are cryptographically broken. **SHA-256** is the current standard.
* **Post-Quantum Readiness:** While still emerging in 2026, scanning for "hybrid" or quantum-resistant algorithms is becoming a standard for future-proofing sensitive data.

## 3. Protocol & Cipher Suite Configuration
The certificate is the key, but the "protocol" is how the door is locked.

* **Protocol Versions:** * **Enable:** TLS 1.2 and **TLS 1.3**.
    * **Disable:** SSL 2.0, SSL 3.0, TLS 1.0, and TLS 1.1 (all have known critical vulnerabilities like POODLE or BEAST).
* **Cipher Suites:** Scan for weak ciphers like **RC4, 3DES, or Export-grade ciphers**. You should prioritize **AEAD** ciphers (like AES-GCM or CHACHA20-POLY1305).
* **Forward Secrecy (PFS):** Check if the server supports Ephemeral Diffie-Hellman (**ECDHE**). This ensures that even if the server’s private key is stolen later, past recorded traffic cannot be decrypted.



## 4. Advanced Security Headers
A secure certificate can still be bypassed if the browser isn't told to stay on the secure path.

* **HSTS (HTTP Strict Transport Security):** This header tells the browser to *never* use the insecure HTTP version of the site, preventing "downgrade attacks."
* **Certificate Pinning:** For high-security mobile apps, verify if the app only accepts a specific certificate or public key.
* **CAA (Certificate Authority Authorization):** A DNS record that specifies which CAs are allowed to issue certificates for your domain, preventing "shadow" certificates from being created elsewhere.

---

### Comparison of Certificate Validation Levels
| Level | Verification Depth | Best Use Case |
| :--- | :--- | :--- |
| **Domain Validated (DV)** | Automated check of domain ownership. | Blogs, personal sites. |
| **Organization Validated (OV)** | Manual check of the company's legal existence. | Business websites, internal tools. |
| **Extended Validation (EV)** | Rigorous background check of the legal entity. | High-trust sites (Banks, E-commerce). |

**Pro-Tip:** Use tools like **SSL Labs (Qualys)** or the CLI tool **testssl.sh** to run these scans automatically. They provide a comprehensive "grade" (A+ to F) based on these exact criteria.