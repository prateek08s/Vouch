/** How to reach whoever runs this Vouch site. Set NEXT_PUBLIC_CONTACT_EMAIL before launch. */
export function Contact() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  if (!email) return <>through the site&apos;s GitHub repository</>;
  return <a href={`mailto:${email}`}>{email}</a>;
}
