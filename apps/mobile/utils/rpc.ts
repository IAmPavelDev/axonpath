import { Platform } from 'react-native'
import { createORPCClient, onError } from '@orpc/client'
import type { AppContract } from '@axon/api-contract'
import { ContractRouterClient } from '@orpc/contract'
import { RPCLink } from '@orpc/client/fetch'
import { firebaseAuth } from '@/lib/firebase'

// EXPO_PUBLIC_API_URL overrides the RPC origin (e.g. a LAN device hitting a
// dev machine); the platform defaults keep emulator/web behavior unchanged.
const baseUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  Platform.select({
    web: 'http://localhost:3001',
    default: 'http://10.0.2.2:3001',
  })

const link = new RPCLink({
  url: `${baseUrl}/rpc`,
  // getIdToken() transparently refreshes an expired token before every call;
  // the backend verifies it against Google's public keys.
  headers: async () => {
    const token = firebaseAuth ? await firebaseAuth.currentUser?.getIdToken() : undefined
    return token ? { authorization: `Bearer ${token}` } : {}
  },
  interceptors: [
    onError((error) => {
      console.error(error)
    })
  ],
})

const client: ContractRouterClient<AppContract> = createORPCClient(link)

export default client

