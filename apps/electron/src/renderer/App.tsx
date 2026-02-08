import * as React from 'react'
import { AppShell } from './components/app-shell/AppShell'
import { TooltipProvider } from './components/ui/tooltip'
import { CloudAuthGate } from './components/cloud-auth'
import type { AppShellContextType } from './contexts/AppShellContext'

export default function App(): React.ReactElement {
  // Placeholder context value
  const contextValue: AppShellContextType = {}

  return (
    <TooltipProvider delayDuration={200}>
      <CloudAuthGate>
        <AppShell contextValue={contextValue} />
      </CloudAuthGate>
    </TooltipProvider>
  )
}
