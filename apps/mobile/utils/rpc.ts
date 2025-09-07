import { createORPCClient, onError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppRouter } from '@axon/api-contract'
import { ContractRouterClient } from '@orpc/contract'

const link = new RPCLink({
  url: 'http://10.0.2.2:3001/rpc',
  headers: () => ({
    authorization: 'Bearer token',
  }),
  // fetch: <-- provide fetch polyfill fetch if needed
  interceptors: [
    onError((error) => {
      console.error(error)
    })
  ],
})

const client: ContractRouterClient<AppRouter> = createORPCClient(link)

export default client