import { Platform } from 'react-native'
import { createORPCClient, onError } from '@orpc/client'
import type { AppContract } from '@axon/api-contract'
import { ContractRouterClient } from '@orpc/contract'
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({
  url: Platform.select({
    web: 'http://localhost:3001/rpc',
    default: 'http://10.0.2.2:3001/rpc',
  }),
  headers: () => ({
    authorization: 'Bearer token',
  }),
  interceptors: [
    onError((error) => {
      console.error(error)
    })
  ],
})

const client: ContractRouterClient<AppContract> = createORPCClient(link)

export default client