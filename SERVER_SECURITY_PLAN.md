Implement the following plan:                                                                   
                                                                                                  
  # Security Features Implementation Plan                                                         
                                                                                                  
  ## Overview                                                                                     
  Implement four security checklist items for ServerKit agent system:                             
  1. API Key Rotation                                                                             
  2. IP Allowlisting                                                                              
  3. Anomaly Detection                                                                            
  4. Replay Protection (Nonces)                                                                   
                                                                                                  
  ---                                                                                             
                                                                                                  
  ## Phase 1: Foundation & Replay Protection                                                      
                                                                                                  
  ### 1.1 Add Crypto Utilities                                                                    
  **File:** `backend/app/utils/crypto.py` (NEW)                                                   
                                                                                                  
  ```python                                                                                       
  from cryptography.fernet import Fernet                                                          
  import os                                                                                       
                                                                                                  
  def get_encryption_key():                                                                       
  key = os.environ.get('SERVERKIT_ENCRYPTION_KEY')                                                
  if not key:                                                                                     
  raise ValueError("SERVERKIT_ENCRYPTION_KEY not set")                                            
  return key.encode()                                                                             
                                                                                                  
  def encrypt_secret(plaintext: str) -> str                                                       
  def decrypt_secret(encrypted: str) -> str                                                       
  ```                                                                                             
                                                                                                  
  ### 1.2 Add IP Utilities                                                                        
  **File:** `backend/app/utils/ip_utils.py` (NEW)                                                 
                                                                                                  
  ```python                                                                                       
  def is_ip_allowed(client_ip: str, allowed_list: list) -> bool:                                  
  """Supports: single IP, CIDR (192.168.1.0/24), wildcards (192.168.1.*)"""                       
  ```                                                                                             
                                                                                                  
  ### 1.3 Update Server Model                                                                     
  **File:** `backend/app/models/server.py`                                                        
                                                                                                  
  Add fields:                                                                                     
  ```python                                                                                       
  api_secret_encrypted = db.Column(db.Text)  # Fernet-encrypted api_secret for signature          
  verification                                                                                    
  api_key_pending_hash = db.Column(db.String(256))  # For key rotation                            
  api_key_pending_prefix = db.Column(db.String(12))                                               
  api_key_rotation_expires = db.Column(db.DateTime)                                               
  ```                                                                                             
                                                                                                  
  ### 1.4 Update Registration to Store Encrypted Secret                                           
  **File:** `backend/app/api/servers.py`                                                          
                                                                                                  
  In `register_agent()`:                                                                          
  - After generating credentials, encrypt and store `api_secret`                                  
  - Existing agents without encrypted secret continue working (backward compatible)               
                                                                                                  
  ### 1.5 Implement Full Signature Verification                                                   
  **File:** `backend/app/services/agent_registry.py`                                              
                                                                                                  
  Update `verify_agent_auth()`:                                                                   
  ```python                                                                                       
  def verify_agent_auth(self, agent_id, api_key_prefix, signature, timestamp, nonce=None):        
  # 1. Check timestamp (existing 5-minute window)                                                 
  # 2. Find server by agent_id                                                                    
  # 3. Verify api_key_prefix (existing)                                                           
  # 4. NEW: Verify HMAC signature if api_secret_encrypted exists                                  
  # 5. NEW: Check nonce not already used (replay protection)                                      
  ```                                                                                             
                                                                                                  
  ### 1.6 Add Nonce Tracking Service                                                              
  **File:** `backend/app/services/nonce_service.py` (NEW)                                         
                                                                                                  
  ```python                                                                                       
  class NonceService:                                                                             
  """Track used nonces to prevent replay attacks (5-minute TTL)."""                               
                                                                                                  
  def check_and_record(self, server_id: str, nonce: str) -> bool:                                 
  """Returns True if valid, False if replay detected."""                                          
  ```                                                                                             
                                                                                                  
  ---                                                                                             
                                                                                                  
  ## Phase 2: IP Allowlisting                                                                     
                                                                                                  
  ### 2.1 Enforce IP Check in Gateway                                                             
  **File:** `backend/app/agent_gateway.py`                                                        
                                                                                                  
  In `on_auth()` after authentication:                                                            
  ```python                                                                                       
  if server.allowed_ips and len(server.allowed_ips) > 0:                                          
  if not is_ip_allowed(request.remote_addr, server.allowed_ips):                                  
  emit('auth_fail', {'error': 'IP address not allowed'})                                          
  # Log security event                                                                            
  disconnect()                                                                                    
  return                                                                                          
  ```                                                                                             
                                                                                                  
  ### 2.2 Add API Endpoint                                                                        
  **File:** `backend/app/api/servers.py`                                                          
                                                                                                  
  ```                                                                                             
  PUT /api/servers/<server_id>/allowed-ips                                                        
  Body: { "allowed_ips": ["192.168.1.0/24", "10.0.0.5"] }                                         
                                                                                                  
  GET /api/servers/<server_id>/connection-info                                                    
  Response: { "connected": bool, "ip_address": str, "connected_since": str }                      
  ```                                                                                             
                                                                                                  
  ### 2.3 Add Frontend UI                                                                         
  **File:** `frontend/src/pages/ServerDetail.jsx`                                                 
                                                                                                  
  In SettingsTab, add "IP Allowlist" section:                                                     
  - Show current connection IP                                                                    
  - List of allowed IPs with add/remove                                                           
  - Support CIDR notation                                                                         
  - Warning if current IP would be blocked                                                        
                                                                                                  
  ### 2.4 Add Frontend API Methods                                                                
  **File:** `frontend/src/services/api.js`                                                        
                                                                                                  
  ```javascript                                                                                   
  async updateAllowedIPs(serverId, allowedIPs)                                                    
  async getConnectionInfo(serverId)                                                               
  ```                                                                                             
                                                                                                  
  ---                                                                                             
                                                                                                  
  ## Phase 3: Anomaly Detection                                                                   
                                                                                                  
  ### 3.1 Create Security Alert Model                                                             
  **File:** `backend/app/models/security_alert.py` (NEW)                                          
                                                                                                  
  ```python                                                                                       
  class SecurityAlert(db.Model):                                                                  
  id = db.Column(db.String(36), primary_key=True)                                                 
  server_id = db.Column(db.String(36), ForeignKey('servers.id'))                                  
  alert_type = db.Column(db.String(50))  # auth_failure, rate_limit, new_ip,                      
  suspicious_pattern                                                                              
  severity = db.Column(db.String(20))    # info, warning, critical                                
  source_ip = db.Column(db.String(45))                                                            
  details = db.Column(db.JSON)                                                                    
  status = db.Column(db.String(20), default='open')  # open, acknowledged, resolved               
  created_at = db.Column(db.DateTime)                                                             
  ```                                                                                             
                                                                                                  
  ### 3.2 Create Anomaly Detection Service                                                        
  **File:** `backend/app/services/anomaly_detection_service.py` (NEW)                             
                                                                                                  
  ```python                                                                                       
  class AnomalyDetectionService:                                                                  
  THRESHOLDS = {                                                                                  
  'auth_failures_per_minute': 5,                                                                  
  'auth_failures_per_hour': 20,                                                                   
  'commands_per_minute': 100,                                                                     
  }                                                                                               
                                                                                                  
  def track_auth_attempt(self, server_id, success, ip_address)                                    
  def track_command(self, server_id, command_type)                                                
  def check_new_ip(self, server_id, ip_address)  # Alert on first connection from new IP          
  def get_alerts(self, server_id=None, status='open')                                             
  ```                                                                                             
                                                                                                  
  ### 3.3 Integrate Detection in Gateway                                                          
  **File:** `backend/app/agent_gateway.py`                                                        
                                                                                                  
  - Call `track_auth_attempt()` on auth success/failure                                           
  - Call `check_new_ip()` on successful connection                                                
  - Call `track_command()` when routing commands                                                  
                                                                                                  
  ### 3.4 Add API Endpoints                                                                       
  **File:** `backend/app/api/servers.py`                                                          
                                                                                                  
  ```                                                                                             
  GET /api/servers/<server_id>/security/alerts                                                    
  GET /api/servers/security/alerts  # All servers                                                 
  POST /api/servers/security/alerts/<alert_id>/acknowledge                                        
  POST /api/servers/security/alerts/<alert_id>/resolve                                            
  ```                                                                                             
                                                                                                  
  ### 3.5 Add Frontend UI                                                                         
  **File:** `frontend/src/pages/ServerDetail.jsx`                                                 
                                                                                                  
  Add "Security" tab or section showing:                                                          
  - Active alerts with severity badges                                                            
  - Acknowledge/resolve buttons                                                                   
  - Recent security events                                                                        
                                                                                                  
  ### 3.6 Add Frontend API Methods                                                                
  **File:** `frontend/src/services/api.js`                                                        
                                                                                                  
  ```javascript                                                                                   
  async getSecurityAlerts(serverId)                                                               
  async acknowledgeAlert(alertId)                                                                 
  async resolveAlert(alertId)                                                                     
  ```                                                                                             
                                                                                                  
  ---                                                                                             
                                                                                                  
  ## Phase 4: API Key Rotation                                                                    
                                                                                                  
  ### 4.1 Add Rotation Endpoint                                                                   
  **File:** `backend/app/api/servers.py`                                                          
                                                                                                  
  ```                                                                                             
  POST /api/servers/<server_id>/rotate-api-key                                                    
  ```                                                                                             
  - Generate new api_key and api_secret                                                           
  - Store in pending fields (api_key_pending_hash, etc.)                                          
  - Set 5-minute expiry                                                                           
  - Send `credential_update` message to connected agent                                           
  - Return { success: true, rotation_id: str }                                                    
                                                                                                  
  ### 4.2 Add WebSocket Message Handlers                                                          
  **File:** `backend/app/agent_gateway.py`                                                        
                                                                                                  
  Handle `credential_update_ack` from agent:                                                      
  - Verify rotation_id matches                                                                    
  - Move pending credentials to active                                                            
  - Clear pending fields                                                                          
  - Log rotation complete                                                                         
                                                                                                  
  ### 4.3 Update Agent to Handle Credential Rotation                                              
  **File:** `agent/internal/agent/agent.go`                                                       
                                                                                                  
  Add handler for `credential_update` message:                                                    
  ```go                                                                                           
  func (a *Agent) handleCredentialUpdate(data CredentialUpdateMessage) {                          
  // 1. Decrypt and validate new credentials                                                      
  // 2. Save to agent.key file                                                                    
  // 3. Update authenticator with new credentials                                                 
  // 4. Send credential_update_ack                                                                
  }                                                                                               
  ```                                                                                             
                                                                                                  
  ### 4.4 Add Protocol Constants                                                                  
  **File:** `agent/pkg/protocol/messages.go`                                                      
                                                                                                  
  ```go                                                                                           
  const (                                                                                         
  TypeCredentialUpdate    = "credential_update"                                                   
  TypeCredentialUpdateAck = "credential_update_ack"                                               
  )                                                                                               
  ```                                                                                             
                                                                                                  
  ### 4.5 Add Frontend UI                                                                         
  **File:** `frontend/src/pages/ServerDetail.jsx`                                                 
                                                                                                  
  In SettingsTab Security section:                                                                
  - "Rotate API Key" button                                                                       
  - Confirmation modal                                                                            
  - Status indicator during rotation                                                              
  - Last rotation timestamp display                                                               
                                                                                                  
  ### 4.6 Add Frontend API Method                                                                 
  **File:** `frontend/src/services/api.js`                                                        
                                                                                                  
  ```javascript                                                                                   
  async rotateAPIKey(serverId)                                                                    
  ```                                                                                             
                                                                                                  
  ---                                                                                             
                                                                                                  
  ## File Summary                                                                                 
                                                                                                  
  | File | Action | Changes |                                                                     
  |------|--------|---------|                                                                     
  | `backend/app/utils/crypto.py` | CREATE | Fernet encryption utilities |                        
  | `backend/app/utils/ip_utils.py` | CREATE | IP matching utilities |                            
  | `backend/app/models/server.py` | MODIFY | Add 4 new fields |                                  
  | `backend/app/models/security_alert.py` | CREATE | SecurityAlert model |                       
  | `backend/app/services/nonce_service.py` | CREATE | Nonce tracking |                           
  | `backend/app/services/anomaly_detection_service.py` | CREATE | Anomaly detection |            
  | `backend/app/services/agent_registry.py` | MODIFY | Full signature verification |             
  | `backend/app/agent_gateway.py` | MODIFY | IP enforcement, anomaly tracking |                  
  | `backend/app/api/servers.py` | MODIFY | 6+ new endpoints |                                    
  | `agent/pkg/protocol/messages.go` | MODIFY | Add credential update constants |                 
  | `agent/internal/agent/agent.go` | MODIFY | Handle credential rotation |                       
  | `frontend/src/services/api.js` | MODIFY | Add 6 new API methods |                             
  | `frontend/src/pages/ServerDetail.jsx` | MODIFY | Add Security section in settings |           
                                                                                                  
  ---                                                                                             
                                                                                                  
  ## Environment Setup                                                                            
                                                                                                  
  Add to `.env`:                                                                                  
  ```                                                                                             
  SERVERKIT_ENCRYPTION_KEY=<generate with: python -c "from cryptography.fernet import Fernet;     
  print(Fernet.generate_key().decode())">                                                         
  ```                                                                                             
                                                                                                  
  ---                                                                                             
                                                                                                  
  ## Verification                                                                                 
                                                                                                  
  1. **Replay Protection:**                                                                       
  - Register new agent, verify `api_secret_encrypted` is stored                                   
  - Replay captured auth message, verify rejection                                                
                                                                                                  
  2. **IP Allowlisting:**                                                                         
  - Set allowed_ips for server                                                                    
  - Connect from allowed IP - should work                                                         
  - Connect from blocked IP - should fail with "IP address not allowed"                           
                                                                                                  
  3. **Anomaly Detection:**                                                                       
  - Trigger 5+ failed auth attempts, verify alert created                                         
  - Connect from new IP, verify info alert                                                        
  - Check alerts appear in UI                                                                     
                                                                                                  
  4. **API Key Rotation:**                                                                        
  - Click rotate in UI                                                                            
  - Verify agent receives new credentials                                                         
  - Verify agent continues working with new key                                                   
  - Verify old key no longer works                                                                
                                                                                                  
  ---                                                                                             
                                                                                                  
  ## Security Notes                                                                               
                                                                                                  
  - `SERVERKIT_ENCRYPTION_KEY` must be securely generated and stored                              
  - Existing agents without encrypted secret continue working (backward compatible)               
  - Nonce tracking uses in-memory storage (Redis recommended for production)                      
  - All security events logged to SecurityAlert model                                             
                                                                                                  
                                                                                                  
  If you need specific details from before exiting plan mode (like exact code snippets, error     
  messages, or content you generated), read the full transcript at: C:\Users\Juan\.claude\pr      
  ojects\C--Users-Juan-Documents-GitHub-ServerKit\11807e92-eec1-4123-8510-9b549a358667.jsonl 