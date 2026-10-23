/** Public protocol-only fixtures; no account data or credentials. */
export function canvaMetadataResponse(url: string): Response | undefined {
  if (url === 'https://api.canva.com/.well-known/oauth-protected-resource/connect/v1/mcp') {
    return Response.json({ resource: 'https://api.canva.com/connect/v1/mcp', authorization_servers: ['https://www.canva.com'],
      scopes_supported: ['design:content:read', 'design:content:write', 'design:meta:read'] });
  }
  if (['https://www.canva.com/.well-known/oauth-authorization-server', 'https://www.canva.com/.well-known/openid-configuration'].includes(url)) {
    return Response.json({ issuer: 'https://www.canva.com', authorization_endpoint: 'https://www.canva.com/api/oauth/authorize',
      token_endpoint: 'https://api.canva.com/auth/v1/oauth/token', code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'], grant_types_supported: ['authorization_code', 'refresh_token'] });
  }
}
