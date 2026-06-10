import logoUrl from '../../assets/brand/stray-circuits-horizontal-light.svg';
import { openExternal } from '../../lib/openExternal';
import styles from './AboutScreen.module.css';

interface AboutScreenProps {
  onBack: () => void;
}

interface ExternalLink {
  href: string;
  icon: string;
  label: string;
}

const SC_LINKS: ExternalLink[] = [
  {
    href: 'https://straycircuits.com',
    icon: 'ti ti-world',
    label: 'straycircuits.com',
  },
  {
    href: 'https://straycircuits.com/about/',
    icon: 'ti ti-info-circle',
    label: 'About Stray Circuits',
  },
  {
    href: 'https://reverb.com/shop/zachs-gear-locker-98',
    icon: 'ti ti-shopping-bag',
    label: 'Shop on Reverb',
  },
  {
    href: 'https://www.instagram.com/straycircuits/',
    icon: 'ti ti-brand-instagram',
    label: '@straycircuits on Instagram',
  },
];

const APP_LINKS: ExternalLink[] = [
  {
    href: 'https://github.com/Stray-Circuits/rig-planner-app/issues',
    icon: 'ti ti-brand-github',
    label: 'Report an issue on GitHub',
  },
];

interface AppFeature {
  icon: string;
  label: string;
}

const APP_FEATURES: AppFeature[] = [
  { icon: 'ti ti-shield-lock', label: 'Zero Data Collection' },
  { icon: 'ti ti-gift', label: 'Free Forever' },
  { icon: 'ti ti-code', label: '100% Open Source' },
];

function LinkList({ links }: { links: ExternalLink[] }) {
  return (
    <ul className={styles.links}>
      {links.map((link) => (
        <li key={link.href}>
          <button
            type="button"
            className={styles.linkRow}
            onClick={() => {
              void openExternal(link.href);
            }}
          >
            <i className={link.icon} aria-hidden />
            <span className={styles.linkLabel}>{link.label}</span>
            <i
              className={`ti ti-external-link ${styles.chevron}`}
              aria-hidden
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AboutScreen({ onBack }: AboutScreenProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.fabTopLeft}>
        <button
          type="button"
          className={styles.fab}
          aria-label="Back to rigs"
          onClick={onBack}
        >
          <i className="ti ti-chevron-left" aria-hidden />
        </button>
      </div>

      <main className={styles.body}>
        <h1 className={styles.appTitle}>Rig Planner</h1>

        <ul className={styles.featureList}>
          {APP_FEATURES.map((feature) => (
            <li key={feature.label} className={styles.featureItem}>
              <i className={feature.icon} aria-hidden />
              <span>{feature.label}</span>
            </li>
          ))}
        </ul>

        <LinkList links={APP_LINKS} />

        <section className={styles.makerSection}>
          <p className={styles.makerCredit}>Made by</p>
          <div className={styles.logoFrame}>
            <img
              className={styles.logo}
              src={logoUrl}
              alt="Stray Circuits"
              draggable={false}
            />
          </div>

          <p className={styles.blurb}>
            Stray Circuits is a one-person guitar pedal shop building cat-themed
            pedals in small batches. DM us on Instagram to order a pedal
            featuring your own cat!
          </p>

          <LinkList links={SC_LINKS} />
        </section>

        <p className={styles.colophon}>
          ❤️ Powered by cat snuggles and purrs 🐾
        </p>
      </main>
    </div>
  );
}
