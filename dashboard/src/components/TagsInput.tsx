import { useState } from 'react';
import {
  Box, Stack, Chip, TextField, IconButton, Autocomplete,
  Typography, Paper,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

export interface Tag {
  key: string;
  value: string;
}

interface TagsInputProps {
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
  existingKeys?: string[];
  disabled?: boolean;
}

export function TagsInput({ tags, onChange, existingKeys = [], disabled }: TagsInputProps) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const handleAdd = () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key) return;
    // Prevent duplicate keys
    if (tags.some((t) => t.key === key)) {
      // Update existing
      onChange(tags.map((t) => t.key === key ? { key, value } : t));
    } else {
      onChange([...tags, { key, value }]);
    }
    setNewKey('');
    setNewValue('');
  };

  const handleRemove = (key: string) => {
    onChange(tags.filter((t) => t.key !== key));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        Tags
      </Typography>

      {/* Existing tags */}
      {tags.length > 0 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
          {tags.map((t) => (
            <Chip
              key={t.key}
              label={t.value ? `${t.key}: ${t.value}` : t.key}
              size="small"
              onDelete={disabled ? undefined : () => handleRemove(t.key)}
              sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
            />
          ))}
        </Stack>
      )}

      {/* Add new tag */}
      {!disabled && (
        <Stack direction="row" spacing={1} alignItems="center">
          <Autocomplete
            freeSolo
            size="small"
            options={existingKeys.filter((k) => !tags.some((t) => t.key === k))}
            value={newKey}
            onInputChange={(_, v) => setNewKey(v)}
            renderInput={(params) => (
              <TextField {...params} placeholder="Key" size="small" onKeyDown={handleKeyDown} />
            )}
            sx={{ minWidth: 140 }}
            PaperComponent={(props) => <Paper {...props} sx={{ fontSize: '0.8rem' }} />}
          />
          <TextField
            size="small"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={handleKeyDown}
            sx={{ minWidth: 140 }}
          />
          <IconButton size="small" onClick={handleAdd} disabled={!newKey.trim()}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Stack>
      )}
    </Box>
  );
}
