import { spawn } from 'node:child_process'

const children = []

function run(label, command, args) {
  const child = spawn(command, args, {
    env: process.env,
    shell: true,
    stdio: 'inherit',
  })

  children.push(child)

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${label} exited with code ${code}`)
      shutdown(code)
    }
  })
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill()
  }

  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('sync', 'npm', ['run', 'sync'])
run('vite', 'npm', ['run', 'dev:vite'])