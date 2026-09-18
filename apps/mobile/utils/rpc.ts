import { Platform } from 'react-native'
import { createORPCClient, onError } from '@orpc/client'
import type { AppContract } from '@axon/api-contract'
import { ContractRouterClient } from '@orpc/contract'
import { RPCLink } from '@orpc/client/fetch'
import { firebaseAuth } from '@/lib/firebase'

const link = new RPCLink({
  url: Platform.select({
    web: 'http://localhost:3001/rpc',
    default: 'http://10.0.2.2:3001/rpc',
  }),
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

