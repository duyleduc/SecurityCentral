import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Chip, Stack,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import GitHubIcon from '@mui/icons-material/GitHub';
import CodeIcon from '@mui/icons-material/Code';
import { useRepositories, type Repository } from '../../api/hooks';

export function RepositoriesPage() {
  const { data: repos, isLoading } = useRepositories();
  const navigate = useNavigate();

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Repositories</Typography>
        <Button
          variant="contained"
          startIcon={<SettingsIcon />}
          onClick={() => navigate('/settings')}
        >
          Manage Integrations
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Repository</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>Language</TableCell>
              <TableCell>Findings</TableCell>
              <TableCell>Last Scan</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}><Skeleton variant="text" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !repos?.length ? (
              <TableRow>
                <TableCell colSpan={5} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                  No repositories imported yet. Go to Settings to connect a provider and import repos.
                </TableCell>
              </TableRow>
            ) : repos.map((r: Repository) => (
              <TableRow
                key={r.id} hover
                sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/repositories/${r.id}`)}
              >
                <TableCell sx={{ fontWeight: 500 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {r.provider === 'github' ? <GitHubIcon fontSize="small" /> : <CodeIcon fontSize="small" />}
                    <span>{r.owner}/{r.name}</span>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Chip label={r.provider} size="small" variant="outlined" />
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{r.language ?? '-'}</TableCell>
                <TableCell>
                  {(r._count?.findings ?? 0) > 0 ? (
                    <Chip label={`${r._count!.findings} open`} size="small" color="warning" />
                  ) : (
                    <Typography variant="body2" color="text.secondary">0</Typography>
                  )}
                </TableCell>
                <TableCell sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                  {r.lastScanAt ? new Date(r.lastScanAt).toLocaleString() : 'Never'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
