'use client';

export default function Button({
  children,
  className = '',
  variant = 'primary',
  type = 'button',
  ...props
}) {
  const styles = 'site-button';
  const variants = {
    primary: 'site-button-primary',
    secondary: 'site-button-secondary',
    tertiary: 'site-button-tertiary',
  };

  return (
    <button type={type} className={`${styles} ${variants[variant]} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
