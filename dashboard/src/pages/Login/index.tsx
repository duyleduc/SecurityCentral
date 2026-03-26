import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.js';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError((err as Error).message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
      <div style={{ width: 400, padding: 32, background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <h1 style={{ fontSize: 24, marginBottom: 8, textAlign: 'center' }}>SecurityCentral</h1>
        <p style={{ color: '#666', textAlign: 'center', marginBottom: 24 }}>Sign in to your account</p>

        {error && <div style={{ color: '#dc2626', background: '#fef2f2', padding: 12, borderRadius: 4, marginBottom: 16, fontSize: 14 }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: '10px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ marginTop: 16, textAlign: 'center', fontSize: 14, color: '#666' }}>
          Don't have an account? <Link to="/register" style={{ color: '#2563eb' }}>Register</Link>
        </p>
      </div>
    </div>
  );
}
