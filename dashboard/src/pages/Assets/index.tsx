import { RepositoriesList } from './RepositoriesList.js';
import { ServersList } from './ServersList.js';
import { CertificatesList } from './CertificatesList.js';

export function AssetsPage({ tab }: { tab: 'repositories' | 'servers' | 'certificates' }) {
  switch (tab) {
    case 'repositories': return <RepositoriesList />;
    case 'servers': return <ServersList />;
    case 'certificates': return <CertificatesList />;
  }
}
