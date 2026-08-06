import * as Lucide from 'lucide-react'

export function RuntimeIcon({ name, className, ...props }) {
  const Icon = Lucide[name] || Lucide.Circle
  return <Icon className={className} {...props} />
}
