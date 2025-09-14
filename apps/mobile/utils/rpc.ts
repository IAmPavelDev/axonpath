import { createORPCClient, onError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppContract } from '@axon/api-contract'
import { ContractRouterClient } from '@orpc/contract'

const link = new RPCLink({
  url: 'http://10.0.2.2:3001/rpc',
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