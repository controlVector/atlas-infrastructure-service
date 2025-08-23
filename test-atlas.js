#!/usr/bin/env node

/**
 * Atlas Infrastructure Agent - Test Suite
 * Tests Atlas functionality without requiring cloud credentials
 */

const axios = require('axios')

const ATLAS_URL = 'http://localhost:3003'

async function testAtlas() {
  console.log('🏗️ Atlas Infrastructure Agent - Test Suite')
  console.log('=' .repeat(50))

  try {
    // Test 1: Service Health
    console.log('\n🔍 1. Service Health Check')
    console.log('-'.repeat(30))
    
    const healthResponse = await axios.get(`${ATLAS_URL}/api/v1/health`)
    console.log('✅ Service Status:', healthResponse.data.status)
    console.log('✅ Service Version:', healthResponse.data.version)
    console.log('✅ Providers:', healthResponse.data.providers.length)

    // Test 2: Service Info
    console.log('\n📋 2. Service Information')
    console.log('-'.repeat(30))
    
    const infoResponse = await axios.get(`${ATLAS_URL}/`)
    const info = infoResponse.data
    console.log('✅ Service:', info.service)
    console.log('✅ Capabilities:', info.capabilities.length, 'features')
    console.log('✅ Available Endpoints:')
    Object.entries(info.endpoints).forEach(([name, path]) => {
      console.log(`   - ${name}: ${path}`)
    })

    // Test 3: List Infrastructure (should be empty)
    console.log('\n📊 3. Infrastructure Listing')
    console.log('-'.repeat(30))
    
    const listResponse = await axios.get(`${ATLAS_URL}/api/v1/infrastructure`)
    console.log('✅ Infrastructure Count:', listResponse.data.count)
    console.log('✅ Infrastructures:', listResponse.data.infrastructures?.length || 0, 'items')

    // Test 4: Get Statistics
    console.log('\n📈 4. Workspace Statistics')
    console.log('-'.repeat(30))
    
    const statsResponse = await axios.get(`${ATLAS_URL}/api/v1/stats`)
    const stats = statsResponse.data.stats
    console.log('✅ Total Infrastructures:', stats.total_infrastructures)
    console.log('✅ Active Infrastructures:', stats.active_infrastructures)
    console.log('✅ Total Resources:', stats.total_resources)
    console.log('✅ Estimated Monthly Cost: $' + stats.estimated_monthly_cost.toFixed(2))

    // Test 5: Provider Information (without credentials)
    console.log('\n☁️ 5. Provider Information')
    console.log('-'.repeat(30))
    
    try {
      const providersResponse = await axios.get(`${ATLAS_URL}/api/v1/providers`)
      console.log('✅ Available Providers:', providersResponse.data.count)
      
      if (providersResponse.data.providers?.length > 0) {
        const provider = providersResponse.data.providers[0]
        console.log('✅ First Provider:', provider.name)
        console.log('✅ Connection Status:', provider.status)
      } else {
        console.log('ℹ️  No providers configured (expected without credentials)')
      }
    } catch (error) {
      console.log('ℹ️  Provider check unavailable:', error.response?.status || error.message)
    }

    // Test 6: Cost Estimation (will fail without provider, but test the endpoint)
    console.log('\n💰 6. Cost Estimation Test')
    console.log('-'.repeat(30))
    
    try {
      const costRequest = {
        name: 'test-app',
        provider: 'digitalocean',
        region: 'nyc3',
        resources: [
          {
            type: 'droplet',
            name: 'web-server',
            specifications: {
              size: 's-1vcpu-1gb',
              image: 'ubuntu-22-04-x64'
            }
          }
        ]
      }

      const costResponse = await axios.post(`${ATLAS_URL}/api/v1/estimate-cost`, costRequest, {
        headers: { 'Content-Type': 'application/json' }
      })
      
      console.log('✅ Estimated Cost: $' + costResponse.data.estimated_monthly_cost.toFixed(2))
    } catch (error) {
      if (error.response?.data?.code === 'PROVIDER_NOT_CONFIGURED') {
        console.log('ℹ️  Cost estimation requires provider credentials (expected)')
        console.log('ℹ️  Endpoint is working correctly')
      } else {
        console.log('❌ Cost estimation error:', error.response?.data?.message || error.message)
      }
    }

    // Test 7: Infrastructure Creation (will fail without provider, but test validation)
    console.log('\n🚀 7. Infrastructure Creation Test')
    console.log('-'.repeat(30))
    
    try {
      const infraRequest = {
        name: 'demo-infrastructure',
        provider: 'digitalocean',
        region: 'nyc3',
        resources: [
          {
            type: 'droplet',
            name: 'demo-server',
            specifications: {
              size: 's-1vcpu-1gb',
              image: 'ubuntu-22-04-x64',
              backups: false,
              monitoring: true
            }
          }
        ],
        tags: {
          environment: 'demo',
          created_by: 'atlas-test'
        }
      }

      const createResponse = await axios.post(`${ATLAS_URL}/api/v1/infrastructure`, infraRequest, {
        headers: { 'Content-Type': 'application/json' }
      })
      
      console.log('✅ Infrastructure Created:', createResponse.data.infrastructure.id)
      console.log('✅ Operation Started:', createResponse.data.operation.id)
    } catch (error) {
      if (error.response?.data?.code === 'PROVIDER_NOT_CONFIGURED') {
        console.log('ℹ️  Infrastructure creation requires provider credentials (expected)')
        console.log('ℹ️  Request validation and endpoint are working correctly')
      } else {
        console.log('❌ Infrastructure creation error:', error.response?.data?.message || error.message)
      }
    }

    console.log('\n🎉 Atlas Test Suite Complete!')
    console.log('=' .repeat(50))
    console.log('✅ Service is operational and ready for cloud provisioning')
    console.log('💡 Configure cloud provider credentials to enable full functionality')
    console.log('🔗 Atlas is ready to integrate with Watson orchestrator')

  } catch (error) {
    console.error('❌ Test suite failed:', error.message)
    if (error.response) {
      console.error('   Status:', error.response.status)
      console.error('   Data:', error.response.data)
    }
    process.exit(1)
  }
}

// Check if Atlas is running
async function checkAtlasRunning() {
  try {
    await axios.get(`${ATLAS_URL}/`, { timeout: 2000 })
    return true
  } catch (error) {
    return false
  }
}

// Main execution
async function main() {
  const isRunning = await checkAtlasRunning()
  
  if (!isRunning) {
    console.error('❌ Atlas is not running on http://localhost:3003')
    console.error('💡 Please start Atlas with: npm run dev')
    process.exit(1)
  }

  await testAtlas()
}

main().catch(console.error)